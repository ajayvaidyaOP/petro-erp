package in.petrolflow;

import javax.crypto.Cipher;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * A small MySQL 8 client. It speaks the text protocol so the API does not need
 * the Connector/J jar or Maven Central. Values stay strings unless the column
 * is an integer, which matches how the frontend already reads 0/1 flags.
 */
public final class Mysql implements AutoCloseable {
    private final String host;
    private final int port;
    private final String database;
    private final String user;
    private final String password;
    private final int connectTimeoutMs;
    private final int socketTimeoutMs;
    private final ReentrantLock lock = new ReentrantLock();
    private Socket socket;
    private InputStream in;
    private OutputStream out;
    private int sequence;
    private boolean inTransaction;
    private boolean foreignKeyChecksDisabled;
    private volatile long lastUsedAtMs;

    public Mysql(String host, int port, String database, String user, String password) {
        this(host, port, database, user, password, 8_000, 30_000);
    }

    public Mysql(
            String host,
            int port,
            String database,
            String user,
            String password,
            int connectTimeoutMs,
            int socketTimeoutMs) {
        this.host = host;
        this.port = port;
        this.database = database;
        this.user = user;
        this.password = password == null ? "" : password;
        this.connectTimeoutMs = Math.max(1_000, connectTimeoutMs);
        this.socketTimeoutMs = Math.max(2_000, socketTimeoutMs);
    }

    public void connect() {
        lock.lock();
        try {
            open(false);
            execUnlocked("CREATE DATABASE IF NOT EXISTS `" + database.replace("`", "``") + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
            execUnlocked("USE `" + database.replace("`", "``") + "`");
            configureSession();
            lastUsedAtMs = System.currentTimeMillis();
        } finally {
            lock.unlock();
        }
    }

    public void connectToExistingDatabase() {
        lock.lock();
        try {
            ensureConnected();
            lastUsedAtMs = System.currentTimeMillis();
        } finally {
            lock.unlock();
        }
    }

    public boolean inTransaction() {
        return inTransaction;
    }

    public boolean isOpen() {
        return socket != null
                && socket.isConnected()
                && !socket.isClosed()
                && !socket.isInputShutdown()
                && !socket.isOutputShutdown();
    }

    public void validateOrReconnect(long idleCheckThresholdMs) {
        lock.lock();
        try {
            if (!isOpen()) {
                ensureConnected();
                lastUsedAtMs = System.currentTimeMillis();
                return;
            }
            if (System.currentTimeMillis() - lastUsedAtMs >= idleCheckThresholdMs) {
                query("SELECT 1");
            }
        } finally {
            lock.unlock();
        }
    }

    public void resetSessionForPool() {
        lock.lock();
        try {
            if (!isOpen()) {
                inTransaction = false;
                foreignKeyChecksDisabled = false;
                return;
            }
            if (inTransaction) {
                try {
                    execUnlocked("ROLLBACK");
                } catch (Throwable ignored) {
                    closeSocket();
                    return;
                } finally {
                    inTransaction = false;
                }
            }
            if (foreignKeyChecksDisabled) {
                try {
                    execUnlocked("SET FOREIGN_KEY_CHECKS = 1");
                    foreignKeyChecksDisabled = false;
                } catch (Throwable ignored) {
                    closeSocket();
                }
            }
        } finally {
            lock.unlock();
        }
    }

    public List<Map<String, Object>> all(String sql, Object... params) {
        return query(sql, params).rows;
    }

    public Map<String, Object> one(String sql, Object... params) {
        List<Map<String, Object>> rows = all(sql, params);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public long count(String sql, Object... params) {
        Map<String, Object> row = one(sql, params);
        if (row == null || row.isEmpty()) return 0;
        Object value = row.values().iterator().next();
        if (value instanceof Number number) return number.longValue();
        if (value == null) return 0;
        return Long.parseLong(String.valueOf(value));
    }

    public int exec(String sql, Object... params) {
        return (int) query(sql, params).affected;
    }

    public <T> T tx(Supplier<T> work) {
        lock.lock();
        try {
            if (inTransaction) return work.get();
            ensureConnected();
            execUnlocked("START TRANSACTION");
            inTransaction = true;
            boolean committed = false;
            try {
                T value = work.get();
                execUnlocked("COMMIT");
                committed = true;
                return value;
            } catch (Throwable error) {
                if (!committed) {
                    if (socket == null || socket.isClosed()) {
                        closeSocket();
                    } else {
                        try {
                            execUnlocked("ROLLBACK");
                        } catch (Throwable ignored) {
                            closeSocket();
                        }
                    }
                }
                if (error instanceof RuntimeException re) throw re;
                if (error instanceof Error err) throw err;
                throw new RuntimeException(error);
            } finally {
                inTransaction = false;
            }
        } finally {
            lock.unlock();
        }
    }

    public void script(String sql) {
        for (String statement : split(sql)) {
            String trimmed = statement.trim();
            if (trimmed.isEmpty()) continue;
            exec(trimmed);
        }
    }

    private Result query(String sql, Object... params) {
        lock.lock();
        try {
            ensureConnected();
            String bound = bind(sql, params);
            trackSessionMutation(bound);
            try {
                Result res = command(bound);
                lastUsedAtMs = System.currentTimeMillis();
                return res;
            } catch (ApiException error) {
                throw error;
            } catch (IOException first) {
                if (inTransaction) {
                    closeSocket();
                    throw new ApiException(503, "DB_UNAVAILABLE", "MySQL connection dropped during a transaction");
                }
                closeSocket();
                ensureConnected();
                try {
                    Result res = command(bound);
                    lastUsedAtMs = System.currentTimeMillis();
                    return res;
                } catch (IOException second) {
                    throw new ApiException(503, "DB_UNAVAILABLE", "MySQL is not reachable at " + host + ":" + port);
                }
            }
        } finally {
            lock.unlock();
        }
    }

    private void trackSessionMutation(String sql) {
        if (sql == null) return;
        String upper = sql.trim().toUpperCase();
        if (upper.startsWith("SET FOREIGN_KEY_CHECKS")) {
            int eq = upper.indexOf('=');
            if (eq > 0) {
                String val = upper.substring(eq + 1).replace(";", "").trim();
                foreignKeyChecksDisabled = "0".equals(val) || "OFF".equals(val) || "FALSE".equals(val);
            }
        }
    }

    private void configureSession() {
        execUnlocked("SET NAMES utf8mb4");
        execUnlocked("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
        execUnlocked("SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        foreignKeyChecksDisabled = false;
    }

    private void execUnlocked(String sql) {
        try {
            command(sql);
            lastUsedAtMs = System.currentTimeMillis();
        } catch (IOException error) {
            throw new ApiException(503, "DB_UNAVAILABLE", "MySQL command failed: " + error.getMessage());
        }
    }

    private void ensureConnected() {
        if (socket != null && socket.isConnected() && !socket.isClosed()) return;
        try {
            open(true);
            configureSession();
        } catch (ApiException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new ApiException(503, "DB_UNAVAILABLE", "Cannot connect to MySQL at " + host + ":" + port + " (" + error.getMessage() + ")");
        }
    }

    private void open(boolean withDatabase) {
        closeSocket();
        try {
            socket = new Socket();
            socket.connect(new InetSocketAddress(host, port), connectTimeoutMs);
            socket.setTcpNoDelay(true);
            socket.setSoTimeout(socketTimeoutMs);
            in = socket.getInputStream();
            out = socket.getOutputStream();
            sequence = 0;
            byte[] greeting = readPacket();
            Handshake hello = parseGreeting(greeting);
            byte[] auth = authResponse(hello.plugin, password, hello.scramble);
            sequence = 1;
            writePacket(handshakeResponse(hello, withDatabase ? database : null, auth));
            finishAuth(readPacket(), hello.plugin, hello.scramble);
        } catch (ApiException error) {
            closeSocket();
            throw error;
        } catch (Exception error) {
            closeSocket();
            throw new ApiException(503, "DB_UNAVAILABLE", "MySQL handshake failed: " + error.getMessage());
        }
    }

    private Result command(String sql) throws IOException {
        byte[] bytes = sql.getBytes(StandardCharsets.UTF_8);
        byte[] payload = new byte[bytes.length + 1];
        payload[0] = 0x03;
        System.arraycopy(bytes, 0, payload, 1, bytes.length);
        sequence = 0;
        writePacket(payload);
        return readResult();
    }

    private Result readResult() throws IOException {
        byte[] packet = readPacket();
        int tag = packet[0] & 0xff;
        if (tag == 0x00) return ok(packet);
        if (tag == 0xff) throw sqlError(packet);
        if (tag == 0xfb) throw new ApiException(500, "DB_ERROR", "MySQL LOCAL INFILE is not supported");
        int columns = (int) lenenc(packet, 0).value;
        List<Column> defs = new ArrayList<>();
        for (int i = 0; i < columns; i++) defs.add(parseColumn(readPacket()));
        byte[] marker = readPacket();
        if ((marker[0] & 0xff) == 0xff) throw sqlError(marker);
        List<Map<String, Object>> rows = new ArrayList<>();
        while (true) {
            byte[] row = readPacket();
            int rowTag = row[0] & 0xff;
            if (rowTag == 0xfe && row.length < 9) break;
            if (rowTag == 0xff) throw sqlError(row);
            rows.add(parseRow(row, defs));
        }
        return new Result(rows, rows.size(), 0);
    }

    private static Result ok(byte[] packet) {
        Lenenc affected = lenenc(packet, 1);
        return new Result(List.of(), affected.value, 0);
    }

    private void finishAuth(byte[] packet, String plugin, byte[] scramble) throws Exception {
        int tag = packet[0] & 0xff;
        if (tag == 0x00) return;
        if (tag == 0xff) throw sqlError(packet);
        if (tag == 0xfe) {
            int end = indexOf(packet, (byte) 0, 1);
            if (end < 0) end = packet.length;
            String nextPlugin = new String(packet, 1, end - 1, StandardCharsets.UTF_8);
            int scrambleStart = end + 1;
            int scrambleEnd = indexOf(packet, (byte) 0, scrambleStart);
            if (scrambleEnd < 0) scrambleEnd = packet.length;
            byte[] nextScramble = trimScramble(java.util.Arrays.copyOfRange(packet, scrambleStart, scrambleEnd));
            writePacket(authResponse(nextPlugin, password, nextScramble));
            finishAuth(readPacket(), nextPlugin, nextScramble);
            return;
        }
        if (tag == 0x01) {
            if (packet.length >= 2 && packet[1] == 0x03) {
                byte[] next = readPacket();
                if ((next[0] & 0xff) != 0x00) throw sqlError(next);
                return;
            }
            if (packet.length >= 2 && packet[1] == 0x04) {
                writePacket(new byte[] {0x02});
                byte[] keyPacket = readPacket();
                if ((keyPacket[0] & 0xff) != 0x01) throw sqlError(keyPacket);
                String pem = new String(keyPacket, 1, keyPacket.length - 1, StandardCharsets.UTF_8);
                writePacket(rsaEncrypt(password, scramble, pem));
                byte[] done = readPacket();
                if ((done[0] & 0xff) != 0x00) throw sqlError(done);
                return;
            }
            if (packet.length > 40 && new String(packet, 1, Math.min(packet.length - 1, 30), StandardCharsets.UTF_8).contains("BEGIN PUBLIC KEY")) {
                String pem = new String(packet, 1, packet.length - 1, StandardCharsets.UTF_8);
                writePacket(rsaEncrypt(password, scramble, pem));
                byte[] done = readPacket();
                if ((done[0] & 0xff) != 0x00) throw sqlError(done);
                return;
            }
        }
        throw new ApiException(503, "DB_UNAVAILABLE", "Unexpected MySQL auth packet 0x" + Integer.toHexString(tag));
    }

    private byte[] handshakeResponse(Handshake hello, String schema, byte[] auth) {
        int caps = 0x0000_0001 | 0x0000_0004 | 0x0000_0200 | 0x0000_2000 | 0x0000_8000
                | 0x0002_0000 | 0x0008_0000 | 0x0020_0000 | 0x0000_0002;
        if (schema != null && !schema.isEmpty()) caps |= 0x0000_0008;
        // Keep the auth flags this client actually writes. Masking them off
        // when a server greeting is short makes the handshake unreadable.
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        writeInt(body, caps, 4);
        writeInt(body, 16 * 1024 * 1024, 4);
        body.write(255);
        for (int i = 0; i < 23; i++) body.write(0);
        writeNull(body, user);
        writeLenenc(body, auth);
        if (schema != null && !schema.isEmpty()) writeNull(body, schema);
        writeNull(body, hello.plugin == null || hello.plugin.isEmpty() ? "caching_sha2_password" : hello.plugin);
        return body.toByteArray();
    }

    private static byte[] authResponse(String plugin, String password, byte[] scramble) throws Exception {
        if (password == null || password.isEmpty()) return new byte[0];
        if ("mysql_native_password".equals(plugin)) return nativePassword(password, scramble);
        return cachingSha2(password, scramble);
    }

    private static byte[] cachingSha2(String password, byte[] scramble) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        byte[] hash1 = sha.digest(password.getBytes(StandardCharsets.UTF_8));
        byte[] hash2 = sha.digest(hash1);
        sha.update(hash2);
        sha.update(scramble);
        byte[] hash3 = sha.digest();
        byte[] out = new byte[hash1.length];
        for (int i = 0; i < out.length; i++) out[i] = (byte) (hash1[i] ^ hash3[i]);
        return out;
    }

    private static byte[] nativePassword(String password, byte[] scramble) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-1");
        byte[] stage1 = sha.digest(password.getBytes(StandardCharsets.UTF_8));
        byte[] stage2 = sha.digest(stage1);
        sha.update(scramble);
        sha.update(stage2);
        byte[] stage3 = sha.digest();
        byte[] out = new byte[stage1.length];
        for (int i = 0; i < out.length; i++) out[i] = (byte) (stage1[i] ^ stage3[i]);
        return out;
    }

    private static byte[] rsaEncrypt(String password, byte[] scramble, String pem) throws Exception {
        String base64 = pem.replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
        byte[] der = Base64.getDecoder().decode(base64);
        var key = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(der));
        byte[] plain = (password + "\0").getBytes(StandardCharsets.UTF_8);
        byte[] xored = new byte[plain.length];
        for (int i = 0; i < plain.length; i++) xored[i] = (byte) (plain[i] ^ scramble[i % scramble.length]);
        Cipher cipher = Cipher.getInstance("RSA/ECB/PKCS1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        return cipher.doFinal(xored);
    }

    private Handshake parseGreeting(byte[] packet) {
        if (packet.length < 20 || packet[0] != 10) {
            throw new ApiException(503, "DB_UNAVAILABLE", "MySQL server sent an unexpected handshake");
        }
        int p = 1;
        int versionEnd = indexOf(packet, (byte) 0, p);
        p = versionEnd + 1 + 4;
        byte[] scramble1 = java.util.Arrays.copyOfRange(packet, p, p + 8);
        p += 9;
        int capLow = u16(packet, p);
        p += 2 + 1 + 2;
        int capHigh = u16(packet, p);
        p += 2;
        int authLen = packet[p] & 0xff;
        p += 1 + 10;
        int part2 = Math.max(13, authLen - 8);
        byte[] scramble2 = java.util.Arrays.copyOfRange(packet, p, Math.min(packet.length, p + part2));
        p += scramble2.length;
        String plugin = p < packet.length ? cstring(packet, p) : "caching_sha2_password";
        byte[] scramble = new byte[20];
        System.arraycopy(scramble1, 0, scramble, 0, 8);
        System.arraycopy(scramble2, 0, scramble, 8, Math.min(12, scramble2.length));
        return new Handshake(scramble, plugin, capLow | (capHigh << 16));
    }

    private Column parseColumn(byte[] packet) {
        int p = 0;
        for (int i = 0; i < 4; i++) p = lenencString(packet, p).next;
        LenencStr name = lenencString(packet, p);
        p = lenencString(packet, name.next).next;
        p++; // 0x0c
        p += 2 + 4;
        int type = packet[p] & 0xff;
        return new Column(name.value, type);
    }

    private Map<String, Object> parseRow(byte[] packet, List<Column> columns) {
        Map<String, Object> row = new LinkedHashMap<>();
        int p = 0;
        for (Column column : columns) {
            if (p >= packet.length) {
                row.put(column.name, null);
                continue;
            }
            if ((packet[p] & 0xff) == 0xfb) {
                row.put(column.name, null);
                p++;
                continue;
            }
            LenencStr value = lenencString(packet, p);
            p = value.next;
            row.put(column.name, coerce(value.value, column.type));
        }
        return row;
    }

    private static Object coerce(String value, int type) {
        if (value == null) return null;
        if (type == 0x01 || type == 0x02 || type == 0x03 || type == 0x08 || type == 0x09) {
            try {
                return Long.parseLong(value);
            } catch (NumberFormatException ignored) {
                return value;
            }
        }
        return value;
    }

    private byte[] readPacket() throws IOException {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        while (true) {
            byte[] header = readFully(4);
            int length = (header[0] & 0xff) | ((header[1] & 0xff) << 8) | ((header[2] & 0xff) << 16);
            sequence = ((header[3] & 0xff) + 1) & 0xff;
            if (length > 0) body.write(readFully(length));
            if (length < 0xffffff) break;
        }
        return body.toByteArray();
    }

    private void writePacket(byte[] payload) throws IOException {
        int offset = 0;
        do {
            int chunk = Math.min(Math.max(payload.length - offset, 0), 0xffffff);
            out.write(chunk & 0xff);
            out.write((chunk >> 8) & 0xff);
            out.write((chunk >> 16) & 0xff);
            out.write(sequence & 0xff);
            sequence = (sequence + 1) & 0xff;
            if (chunk > 0) out.write(payload, offset, chunk);
            offset += chunk;
            if (payload.length == 0) break;
        } while (offset < payload.length);
        out.flush();
    }

    private byte[] readFully(int length) throws IOException {
        byte[] buf = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(buf, read, length - read);
            if (n < 0) throw new IOException("MySQL closed the connection");
            read += n;
        }
        return buf;
    }

    private void closeSocket() {
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
            /* already gone */
        }
        socket = null;
        in = null;
        out = null;
    }

    @Override
    public void close() {
        lock.lock();
        try {
            closeSocket();
        } finally {
            lock.unlock();
        }
    }

    static String bind(String sql, Object[] params) {
        if (params == null || params.length == 0) return sql;
        StringBuilder out = new StringBuilder();
        int index = 0;
        boolean quoted = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (quoted) {
                out.append(c);
                if (c == '\\' && i + 1 < sql.length()) {
                    out.append(sql.charAt(++i));
                } else if (c == '\'') {
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == '\'') out.append(sql.charAt(++i));
                    else quoted = false;
                }
                continue;
            }
            if (c == '\'') {
                quoted = true;
                out.append(c);
                continue;
            }
            if (c == '?') {
                if (index >= params.length) throw new IllegalArgumentException("Missing SQL parameter");
                out.append(literal(params[index++]));
                continue;
            }
            out.append(c);
        }
        if (index != params.length) throw new IllegalArgumentException("Unused SQL parameter");
        return out.toString();
    }

    static String literal(Object value) {
        if (value == null) return "NULL";
        if (value instanceof Boolean flag) return flag ? "1" : "0";
        if (value instanceof Number && !(value instanceof java.math.BigDecimal)) return value.toString();
        String text = String.valueOf(value);
        return "'" + text.replace("\\", "\\\\").replace("'", "\\'").replace("\0", "\\0").replace("\n", "\\n").replace("\r", "\\r") + "'";
    }

    static List<String> split(String sql) {
        List<String> out = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        boolean quoted = false;
        boolean lineComment = false;
        boolean blockComment = false;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            char next = i + 1 < sql.length() ? sql.charAt(i + 1) : 0;
            if (lineComment) {
                if (c == '\n') lineComment = false;
                continue;
            }
            if (blockComment) {
                if (c == '*' && next == '/') {
                    blockComment = false;
                    i++;
                }
                continue;
            }
            if (!quoted && c == '-' && next == '-') {
                lineComment = true;
                i++;
                continue;
            }
            if (!quoted && c == '#') {
                lineComment = true;
                continue;
            }
            if (!quoted && c == '/' && next == '*') {
                blockComment = true;
                i++;
                continue;
            }
            if (c == '\'') {
                current.append(c);
                if (quoted && next == '\'') {
                    current.append(next);
                    i++;
                    continue;
                }
                if (quoted && sql.charAt(Math.max(0, i - 1)) == '\\') continue;
                quoted = !quoted;
                continue;
            }
            if (c == ';' && !quoted) {
                out.add(current.toString());
                current.setLength(0);
                continue;
            }
            current.append(c);
        }
        if (!current.isEmpty()) out.add(current.toString());
        return out;
    }

    private static ApiException sqlError(byte[] packet) {
        int code = packet.length >= 3 ? u16(packet, 1) : 0;
        String message = packet.length > 9 && packet[3] == '#'
                ? new String(packet, 9, packet.length - 9, StandardCharsets.UTF_8)
                : new String(packet, Math.min(3, packet.length), Math.max(0, packet.length - 3), StandardCharsets.UTF_8);
        if (code == 1062) return new ApiException(409, "DUPLICATE", "A record with these details already exists", Map.of("mysql", message));
        if (code == 1451 || code == 1452) return new ApiException(409, "IN_USE", "This record is referenced by other records and cannot be changed");
        if (code == 1213) return new ApiException(503, "DB_DEADLOCK", "Transient transaction serialization conflict", Map.of("mysql", message));
        if (code == 1205) return new ApiException(503, "DB_LOCK_TIMEOUT", "Database lock wait timeout exceeded", Map.of("mysql", message));
        return new ApiException(400, "DB_ERROR", message.isBlank() ? "MySQL rejected the statement" : message);
    }

    private static byte[] trimScramble(byte[] raw) {
        if (raw.length == 20) return raw;
        if (raw.length > 20) return java.util.Arrays.copyOf(raw, 20);
        byte[] out = new byte[20];
        System.arraycopy(raw, 0, out, 0, raw.length);
        return out;
    }

    private static int indexOf(byte[] bytes, byte needle, int from) {
        for (int i = from; i < bytes.length; i++) if (bytes[i] == needle) return i;
        return -1;
    }

    private static String cstring(byte[] bytes, int from) {
        int end = indexOf(bytes, (byte) 0, from);
        if (end < 0) end = bytes.length;
        return new String(bytes, from, end - from, StandardCharsets.UTF_8);
    }

    private static int u16(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    }

    private static void writeInt(ByteArrayOutputStream out, int value, int width) {
        for (int i = 0; i < width; i++) out.write((value >> (8 * i)) & 0xff);
    }

    private static void writeNull(ByteArrayOutputStream out, String value) {
        out.writeBytes(value.getBytes(StandardCharsets.UTF_8));
        out.write(0);
    }

    private static void writeLenenc(ByteArrayOutputStream out, byte[] value) {
        int length = value.length;
        if (length < 251) out.write(length);
        else if (length < 65536) {
            out.write(0xfc);
            out.write(length & 0xff);
            out.write((length >> 8) & 0xff);
        } else {
            out.write(0xfd);
            out.write(length & 0xff);
            out.write((length >> 8) & 0xff);
            out.write((length >> 16) & 0xff);
        }
        out.writeBytes(value);
    }

    private static Lenenc lenenc(byte[] packet, int offset) {
        int first = packet[offset] & 0xff;
        if (first < 251) return new Lenenc(first, offset + 1);
        if (first == 0xfc) return new Lenenc(u16(packet, offset + 1), offset + 3);
        if (first == 0xfd) {
            int value = (packet[offset + 1] & 0xff) | ((packet[offset + 2] & 0xff) << 8) | ((packet[offset + 3] & 0xff) << 16);
            return new Lenenc(value, offset + 4);
        }
        long value = 0;
        for (int i = 0; i < 8; i++) value |= (long) (packet[offset + 1 + i] & 0xff) << (8 * i);
        return new Lenenc(value, offset + 9);
    }

    private static LenencStr lenencString(byte[] packet, int offset) {
        Lenenc length = lenenc(packet, offset);
        int start = length.next;
        int size = (int) length.value;
        return new LenencStr(new String(packet, start, size, StandardCharsets.UTF_8), start + size);
    }

    private record Handshake(byte[] scramble, String plugin, int capabilities) {}
    private record Column(String name, int type) {}
    private record Lenenc(long value, int next) {}
    private record LenencStr(String value, int next) {}
    private record Result(List<Map<String, Object>> rows, long affected, long insertId) {}
}
