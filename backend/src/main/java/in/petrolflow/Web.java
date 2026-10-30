package in.petrolflow;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class Web {
    private static final Set<String> MUTATION_METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final long IDEMPOTENCY_POLL_TIMEOUT_MS = 5_000L;
    private static final long IDEMPOTENCY_POLL_INTERVAL_MS = 25L;
    private static final int COMPLETED_RETENTION_HOURS = 24;
    private final Config config;
    private final Map<String, String> inFlightIdempotencyClaims = new ConcurrentHashMap<>();
    private final List<Route> routes = new CopyOnWriteArrayList<>();
    private final Path spaDist;
    private HttpServer server;
    private ExecutorService executor;

    public Web(Config config) {
        this.config = config;
        Path candidate = Path.of("..", "frontend", "dist").normalize();
        if (!Files.isDirectory(candidate)) candidate = Path.of("frontend", "dist").normalize();
        this.spaDist = Files.isDirectory(candidate) ? candidate : null;
    }

    public static Map<String, Object> map(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) {
            out.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return out;
    }

    public void get(String pattern, Handler handler) { routes.add(new Route("GET", pattern, handler)); }
    public void post(String pattern, Handler handler) { routes.add(new Route("POST", pattern, handler)); }
    public void put(String pattern, Handler handler) { routes.add(new Route("PUT", pattern, handler)); }
    public void patch(String pattern, Handler handler) { routes.add(new Route("PATCH", pattern, handler)); }
    public void delete(String pattern, Handler handler) { routes.add(new Route("DELETE", pattern, handler)); }

    public void listen() throws IOException {
        server = HttpServer.create(new InetSocketAddress(config.host, config.port), 0);
        server.createContext("/", this::dispatch);
        executor = Executors.newFixedThreadPool(16);
        server.setExecutor(executor);
        server.start();
        System.out.println("PetroFlow Java API listening on http://" + config.host + ":" + config.port);
    }

    public void stop() {
        if (server != null) server.stop(0);
        if (executor != null) executor.shutdownNow();
    }

    private void dispatch(HttpExchange exchange) throws IOException {
        Ctx ctx = null;
        try {
            ctx = new Ctx(config, exchange);
            if ("OPTIONS".equals(ctx.method)) {
                ctx.raw(204, "text/plain; charset=utf-8", new byte[0]);
                return;
            }
            if (!ctx.path.startsWith("/api/")) {
                if (serveSpa(ctx)) return;
                ctx.error(404, "NOT_FOUND", "No route for " + ctx.method + " " + ctx.path);
                return;
            }
            if (!ctx.path.startsWith("/api/v1")) {
                ctx.error(404, "NOT_FOUND", "No route for " + ctx.method + " " + ctx.path);
                return;
            }
            ctx.enforceOrigin();
            String path = ctx.path.substring("/api/v1".length());
            if (path.isEmpty()) path = "/";
            for (Route route : routes) {
                if (!route.method.equals(ctx.method)) continue;
                Map<String, String> params = route.match(path);
                if (params == null) continue;
                ctx.params = params;
                executeWithIdempotency(ctx, path, route.handler);
                return;
            }
            ctx.error(404, "NOT_FOUND", "No route for " + ctx.method + " " + ctx.path);
        } catch (ApiException error) {
            if (ctx != null && !ctx.sent) ctx.error(error.status, error.code, error.getMessage(), error.details);
        } catch (Exception error) {
            error.printStackTrace();
            capturePlatformError(ctx, error);
            if (ctx != null && !ctx.sent) {
                String message = error.getMessage();
                if (message != null && (message.contains("Duplicate entry") || message.contains("UNIQUE"))) {
                    ctx.error(409, "DUPLICATE", "A record with these details already exists");
                } else if (message != null && (message.contains("foreign key constraint") || message.contains("FOREIGN KEY"))) {
                    ctx.error(409, "IN_USE", "This record is referenced by other records and cannot be changed");
                } else {
                    ctx.error(500, "INTERNAL_ERROR", config.production ? "An unexpected error occurred" : (message == null ? "Internal server error" : message));
                }
            }
        } finally {
            exchange.close();
        }
    }

    private boolean serveSpa(Ctx ctx) throws IOException {
        if (spaDist == null || (!"GET".equals(ctx.method) && !"HEAD".equals(ctx.method))) return false;
        String rel = ctx.path.startsWith("/") ? ctx.path.substring(1) : ctx.path;
        Path target = rel.isEmpty() ? spaDist.resolve("index.html") : spaDist.resolve(rel).normalize();
        if (!target.startsWith(spaDist) || !Files.isRegularFile(target)) {
            target = spaDist.resolve("index.html");
        }
        if (!Files.isRegularFile(target)) return false;
        byte[] bytes = "HEAD".equals(ctx.method) ? new byte[0] : Files.readAllBytes(target);
        ctx.raw(200, contentType(target.getFileName().toString()), bytes);
        return true;
    }

    private static String contentType(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    private static void capturePlatformError(Ctx ctx, Exception error) {
        try {
            StringWriter sw = new StringWriter();
            error.printStackTrace(new PrintWriter(sw));
            String msg = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            Db.exec(
                    """
                    INSERT INTO platform_errors (id, tenant_id, source, message, detail, path, severity, created_at)
                    VALUES (?, ?, 'api', ?, ?, ?, 'ERROR', ?)
                    """,
                    Clock.newId("err"),
                    ctx != null && ctx.auth != null ? ctx.auth.tenantId : null,
                    msg.length() > 500 ? msg.substring(0, 500) : msg,
                    sw.toString().length() > 4000 ? sw.toString().substring(0, 4000) : sw.toString(),
                    ctx == null ? null : ctx.path,
                    Clock.nowIso());
        } catch (RuntimeException ignored) {
        }
    }

    private static final class IdempotencyClaimConflict extends RuntimeException {
        private static final long serialVersionUID = 1L;
        IdempotencyClaimConflict() { super(null, null, true, false); }
    }

    private static final class IdempotencyNon2xxAbort extends RuntimeException {
        private static final long serialVersionUID = 1L;
        IdempotencyNon2xxAbort() { super(null, null, true, false); }
    }

    private void executeWithIdempotency(Ctx ctx, String routePath, Handler handler) {
        String rawKey = ctx.header("idempotency-key");
        if (rawKey == null || rawKey.isBlank() || !MUTATION_METHODS.contains(ctx.method) || ctx.auth == null || ctx.auth.tenantId == null) {
            handler.handle(ctx);
            if (!ctx.sent) ctx.ok(Map.of());
            return;
        }
        String idemKey = rawKey.trim();
        if (idemKey.length() > 200) {
            throw ApiException.validation("Idempotency-Key", "Idempotency-Key must be at most 200 characters");
        }
        String tenantId = ctx.auth.tenantId;
        String rawQuery = ctx.exchange.getRequestURI().getRawQuery();
        String scope = ctx.method + " " + routePath + (rawQuery == null || rawQuery.isEmpty() ? "" : "?" + rawQuery);
        String requestHash = Passwords.sha256(Json.stringify(canonicalize(ctx.body)));
        String compositeKey = tenantId + "\0" + scope + "\0" + idemKey;
        int leaseSeconds = config.idempotencyLeaseSeconds;

        for (int attempt = 0; attempt < 4; attempt++) {
            if (!awaitAndAcquireInFlightSlot(compositeKey, requestHash)) {
                if (replayCompletedIfPresent(ctx, tenantId, scope, idemKey, requestHash)) {
                    return;
                }
                throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is currently in progress");
            }
            try {
                Db.tx(() -> {
                    ctx.bufferedStatus = 0;
                    ctx.bufferedContentType = null;
                    ctx.bufferedBody = null;

                    String claimId = Clock.newId("idm");
                    String claimNow = Clock.nowIso();
                    String claimExpires = Clock.addSecondsIso(claimNow, leaseSeconds);
                    try {
                        Db.exec(
                                """
                                INSERT INTO `idempotency_keys`
                                  (`id`, `tenant_id`, `scope`, `key`, `request_hash`, `status`, `response_status`, `response_body`, `created_at`, `expires_at`)
                                VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, NULL, ?, ?)
                                """,
                                claimId, tenantId, scope, idemKey, requestHash, claimNow, claimExpires);
                    } catch (ApiException ex) {
                        if ("DUPLICATE".equals(ex.code)) throw new IdempotencyClaimConflict();
                        if ("DB_LOCK_TIMEOUT".equals(ex.code)) {
                            throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is currently in progress");
                        }
                        throw ex;
                    }

                    ctx.bufferJsonForIdempotency = true;
                    try {
                        handler.handle(ctx);
                        if (!ctx.sent && ctx.bufferedBody == null) ctx.ok(Map.of());
                    } finally {
                        ctx.bufferJsonForIdempotency = false;
                    }

                    if (ctx.bufferedBody == null || ctx.bufferedStatus < 200 || ctx.bufferedStatus >= 300) {
                        throw new IdempotencyNon2xxAbort();
                    }

                    String completedNow = Clock.nowIso();
                    String expiresAt = Clock.addHoursIso(completedNow, COMPLETED_RETENTION_HOURS);
                    int updated = Db.exec(
                            """
                            UPDATE `idempotency_keys`
                               SET `status` = 'COMPLETED',
                                   `response_status` = ?,
                                   `response_body` = ?,
                                   `expires_at` = ?
                             WHERE `id` = ? AND `status` = 'IN_PROGRESS'
                            """,
                            ctx.bufferedStatus,
                            new String(ctx.bufferedBody, StandardCharsets.UTF_8),
                            expiresAt,
                            claimId);
                    if (updated != 1) {
                        throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "Idempotency claim lease was invalidated before commit");
                    }
                    return null;
                });
                ctx.raw(ctx.bufferedStatus, ctx.bufferedContentType, ctx.bufferedBody);
                return;
            } catch (IdempotencyNon2xxAbort abort) {
                if (ctx.bufferedBody != null) {
                    ctx.raw(ctx.bufferedStatus, ctx.bufferedContentType, ctx.bufferedBody);
                }
                return;
            } catch (IdempotencyClaimConflict conflict) {
                // Release local slot before polling/clearing so another finishing thread is never blocked
            } finally {
                inFlightIdempotencyClaims.remove(compositeKey, requestHash);
            }

            if (replayOrClearExistingClaim(ctx, tenantId, scope, idemKey, requestHash, compositeKey)) {
                return;
            }
        }
        throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is currently in progress");
    }

    private boolean awaitAndAcquireInFlightSlot(String compositeKey, String requestHash) {
        long deadline = System.currentTimeMillis() + IDEMPOTENCY_POLL_TIMEOUT_MS;
        while (true) {
            String activeHash = inFlightIdempotencyClaims.putIfAbsent(compositeKey, requestHash);
            if (activeHash == null) {
                return true;
            }
            if (!activeHash.equals(requestHash)) {
                throw ApiException.conflict("Idempotency-Key has already been used with a different request payload");
            }
            if (System.currentTimeMillis() >= deadline) {
                return false;
            }
            try {
                Thread.sleep(IDEMPOTENCY_POLL_INTERVAL_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "Interrupted while waiting for in-progress idempotent request");
            }
        }
    }

    private static boolean replayCompletedIfPresent(Ctx ctx, String tenantId, String scope, String idemKey, String requestHash) {
        Map<String, Object> existing = Db.one(
                "SELECT * FROM `idempotency_keys` WHERE `tenant_id` = ? AND `scope` = ? AND `key` = ?",
                tenantId, scope, idemKey);
        if (existing == null) {
            return false;
        }
        if (!"COMPLETED".equals(Db.str(existing, "status"))) {
            if (!requestHash.equals(Db.str(existing, "request_hash"))) {
                throw ApiException.conflict("Idempotency-Key has already been used with a different request payload");
            }
            return false;
        }
        String now = Clock.nowIso();
        String expiresAt = Db.str(existing, "expires_at");
        if (expiresAt != null && expiresAt.compareTo(now) <= 0) {
            return false;
        }
        if (!requestHash.equals(Db.str(existing, "request_hash"))) {
            throw ApiException.conflict("Idempotency-Key has already been used with a different request payload");
        }
        int replayStatus = existing.get("response_status") == null ? 200 : (int) Db.num(existing, "response_status");
        String replayBody = existing.get("response_body") == null ? "{\"data\":{}}" : Db.str(existing, "response_body");
        ctx.exchange.getResponseHeaders().set("Idempotent-Replayed", "true");
        ctx.raw(replayStatus, "application/json; charset=utf-8", replayBody.getBytes(StandardCharsets.UTF_8));
        return true;
    }

    private boolean replayOrClearExistingClaim(
            Ctx ctx,
            String tenantId,
            String scope,
            String idemKey,
            String requestHash,
            String compositeKey) {
        long deadline = System.currentTimeMillis() + IDEMPOTENCY_POLL_TIMEOUT_MS;
        while (true) {
            String now = Clock.nowIso();
            Map<String, Object> existing = Db.one(
                    "SELECT * FROM `idempotency_keys` WHERE `tenant_id` = ? AND `scope` = ? AND `key` = ?",
                    tenantId, scope, idemKey);
            if (existing == null) {
                return false;
            }
            String status = Db.str(existing, "status");
            String expiresAt = Db.str(existing, "expires_at");
            if ("COMPLETED".equals(status)) {
                if (expiresAt != null && expiresAt.compareTo(now) <= 0) {
                    Db.tx(() -> Db.exec(
                            "DELETE FROM `idempotency_keys` WHERE `id` = ? AND `status` = 'COMPLETED' AND `expires_at` <= ?",
                            existing.get("id"), now));
                    return false;
                }
                if (!requestHash.equals(Db.str(existing, "request_hash"))) {
                    throw ApiException.conflict("Idempotency-Key has already been used with a different request payload");
                }
                int replayStatus = existing.get("response_status") == null ? 200 : (int) Db.num(existing, "response_status");
                String replayBody = existing.get("response_body") == null ? "{\"data\":{}}" : Db.str(existing, "response_body");
                ctx.exchange.getResponseHeaders().set("Idempotent-Replayed", "true");
                ctx.raw(replayStatus, "application/json; charset=utf-8", replayBody.getBytes(StandardCharsets.UTF_8));
                return true;
            }

            // Status is IN_PROGRESS (or non-COMPLETED): never evict if original in-JVM transaction is still active
            if (expiresAt != null && expiresAt.compareTo(now) <= 0 && !inFlightIdempotencyClaims.containsKey(compositeKey)) {
                try {
                    int deleted = Db.tx(() -> Db.exec(
                            "DELETE FROM `idempotency_keys` WHERE `id` = ? AND `status` = 'IN_PROGRESS' AND `expires_at` <= ?",
                            existing.get("id"), now));
                    if (deleted > 0) {
                        return false;
                    }
                    continue;
                } catch (ApiException lockEx) {
                    if ("DB_LOCK_TIMEOUT".equals(lockEx.code) || "DB_DEADLOCK".equals(lockEx.code)) {
                        throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is currently in progress");
                    }
                    throw lockEx;
                }
            }

            if (!requestHash.equals(Db.str(existing, "request_hash"))) {
                throw ApiException.conflict("Idempotency-Key has already been used with a different request payload");
            }
            if (System.currentTimeMillis() >= deadline) {
                throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is currently in progress");
            }
            try {
                Thread.sleep(IDEMPOTENCY_POLL_INTERVAL_MS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new ApiException(409, "IDEMPOTENCY_IN_PROGRESS", "Interrupted while waiting for in-progress idempotent request");
            }
        }
    }

    private static Object canonicalize(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                sorted.put(String.valueOf(entry.getKey()), canonicalize(entry.getValue()));
            }
            return sorted;
        }
        if (value instanceof List<?> list) {
            List<Object> out = new ArrayList<>(list.size());
            for (Object item : list) out.add(canonicalize(item));
            return out;
        }
        return value;
    }

    public interface Handler { void handle(Ctx ctx); }

    private record Route(String method, String pattern, Handler handler) {
        Map<String, String> match(String path) {
            String[] want = pattern.split("/");
            String[] got = path.split("/");
            if (want.length != got.length) return null;
            Map<String, String> params = new LinkedHashMap<>();
            for (int i = 0; i < want.length; i++) {
                if (want[i].startsWith(":")) params.put(want[i].substring(1), decode(got[i]));
                else if (!want[i].equals(got[i])) return null;
            }
            return params;
        }
    }

    public static final class Ctx {
        public final Config config;
        public final String method;
        public final String path;
        public final Map<String, String> query;
        public final Map<String, String> headers;
        public Map<String, String> params = Map.of();
        public final Object body;
        public final String ip;
        public Auth auth;
        private final HttpExchange exchange;
        private boolean sent;
        boolean bufferJsonForIdempotency;
        int bufferedStatus;
        String bufferedContentType;
        byte[] bufferedBody;
        public final boolean preview;

        Ctx(Config config, HttpExchange exchange) throws IOException {
            this.config = config;
            this.exchange = exchange;
            this.method = exchange.getRequestMethod();
            this.path = exchange.getRequestURI().getPath();
            this.query = parseQuery(exchange.getRequestURI().getRawQuery());
            this.headers = new LinkedHashMap<>();
            exchange.getRequestHeaders().forEach((key, values) -> {
                if (values != null && !values.isEmpty()) headers.put(key.toLowerCase(), values.get(0));
            });
            this.ip = header("x-forwarded-for") != null
                    ? header("x-forwarded-for").split(",")[0].trim()
                    : exchange.getRemoteAddress().getAddress().getHostAddress();
            this.preview = computePreview();
            cors();
            byte[] raw = exchange.getRequestBody().readNBytes(2_000_001);
            if (raw.length > 2_000_000) throw ApiException.badRequest("Request body is too large");
            String text = new String(raw, StandardCharsets.UTF_8).trim();
            if (text.isEmpty()) this.body = new LinkedHashMap<String, Object>();
            else {
                try {
                    this.body = Json.parse(text);
                } catch (RuntimeException error) {
                    throw ApiException.badRequest("Request body is not valid JSON");
                }
            }
            String token = cookie(config.cookieName);
            if (token == null && !config.production) {
                String authz = header("authorization");
                if (authz != null && authz.regionMatches(true, 0, "Bearer ", 0, 7)) token = authz.substring(7).trim();
            }
            if (token != null && !token.isBlank()) this.auth = Auth.fromToken(token);
        }

        public Auth requireAuth() {
            if (auth == null) throw ApiException.unauthorized("Your session has expired — please sign in again");
            return auth;
        }

        public String q(String key) { return query.get(key); }
        public String p(String key) { return params.get(key); }
        public String header(String key) { return headers.get(key.toLowerCase()); }

        public Map<String, Object> body() { return Json.object(body); }

        public String str(String key) {
            Object value = body().get(key);
            return value == null ? null : String.valueOf(value);
        }

        public void ok(Object data) { json(200, data, null); }
        public void ok(Object data, Object meta) { json(200, data, meta); }
        public void created(Object data) { json(201, data, null); }

        public void json(int status, Object data, Object meta) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("data", data);
            if (meta != null) payload.put("meta", meta);
            raw(status, "application/json; charset=utf-8", Json.stringify(payload).getBytes(StandardCharsets.UTF_8));
        }

        public void error(int status, String code, String message) { error(status, code, message, null); }

        public void error(int status, String code, String message, Object details) {
            Map<String, Object> error = new LinkedHashMap<>();
            error.put("code", code);
            error.put("message", message);
            if (details != null) error.put("details", details);
            raw(status, "application/json; charset=utf-8", Json.stringify(Web.map("error", error)).getBytes(StandardCharsets.UTF_8));
        }

        public void csv(String filename, String text) {
            exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + filename + "\"");
            raw(200, "text/csv; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
        }

        public void cookie(String name, String value, String expiresAt) {
            StringBuilder cookie = new StringBuilder();
            cookie.append(name).append('=').append(value).append("; Path=/; HttpOnly");
            if (expiresAt != null) cookie.append("; Expires=").append(httpDate(expiresAt));
            if (preview) {
                cookie.append("; SameSite=None; Secure");
            } else {
                cookie.append("; SameSite=Lax");
                if (config.cookieSecure) cookie.append("; Secure");
            }
            exchange.getResponseHeaders().add("Set-Cookie", cookie.toString());
        }

        public void clearCookie(String name) {
            String same = preview ? "; SameSite=None; Secure" : "; SameSite=Lax";
            exchange.getResponseHeaders().add("Set-Cookie", name + "=; Path=/; HttpOnly; Max-Age=0" + same);
        }

        public void raw(int status, String type, byte[] bytes) {
            if (bufferJsonForIdempotency) {
                bufferedStatus = status;
                bufferedContentType = type;
                bufferedBody = bytes;
                return;
            }
            if (sent) return;
            sent = true;
            try {
                exchange.getResponseHeaders().set("Content-Type", type);
                exchange.getResponseHeaders().set("Cache-Control", "no-store");
                cors();
                exchange.sendResponseHeaders(status, bytes.length);
                if (!"HEAD".equals(method) && bytes.length > 0) {
                    try (OutputStream out = exchange.getResponseBody()) {
                        out.write(bytes);
                    }
                } else {
                    exchange.getResponseBody().close();
                }
            } catch (IOException error) {
                throw new RuntimeException(error);
            }
        }

        void enforceOrigin() {
            if ("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method)) return;
            String origin = header("origin");
            if (origin == null || origin.isBlank()) return;
            if (!allowed(origin)) throw new ApiException(403, "BAD_ORIGIN", "Cross-origin request blocked");
        }

        private void cors() {
            String origin = header("origin");
            if (origin == null || origin.isBlank()) return;
            if (allowed(origin)) {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
                exchange.getResponseHeaders().set("Access-Control-Allow-Credentials", "true");
                exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Device-Key, X-Request-Id, Authorization");
                exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
                exchange.getResponseHeaders().set("Vary", "Origin");
            }
        }

        private boolean allowed(String origin) {
            if (config.allowedOrigins != null && config.allowedOrigins.contains(origin)) return true;
            String host = effectiveHost();
            if (host != null && (origin.equalsIgnoreCase("http://" + host) || origin.equalsIgnoreCase("https://" + host))) {
                return true;
            }
            if (!config.production) {
                if (origin.matches("(?i)^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?$")) return true;
                if (preview) return true;
            }
            return false;
        }

        private String effectiveHost() {
            String fwd = header("x-forwarded-host");
            if (fwd != null && !fwd.isBlank()) return fwd.split(",")[0].trim();
            return header("host");
        }

        private boolean computePreview() {
            if (config.production) return false;
            String host = effectiveHost();
            String hostOnly = host == null ? "" : host.split(":")[0].trim().toLowerCase();
            if (isPreviewHost(hostOnly)) return true;
            for (String candidate : new String[]{header("origin"), header("referer")}) {
                if (candidate == null || candidate.isBlank()) continue;
                try {
                    URI uri = URI.create(candidate);
                    if ("https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null && isPreviewHost(uri.getHost().toLowerCase())) {
                        return true;
                    }
                } catch (RuntimeException ignored) {
                }
            }
            return false;
        }

        private boolean isPreviewHost(String hostname) {
            if (hostname == null || !hostname.matches("[\\w.-]+\\.e2b\\.app")) return false;
            if (config.sandboxId != null && !config.sandboxId.isBlank()) {
                return hostname.endsWith("-" + config.sandboxId.toLowerCase() + ".e2b.app") || hostname.endsWith(".e2b.app");
            }
            return true;
        }

        private String cookie(String name) {
            String header = header("cookie");
            if (header == null) return null;
            for (String part : header.split(";")) {
                String[] pair = part.trim().split("=", 2);
                if (pair.length == 2 && pair[0].equals(name)) return pair[1];
            }
            return null;
        }
    }

    private static Map<String, String> parseQuery(String raw) {
        Map<String, String> out = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return out;
        for (String pair : raw.split("&")) {
            if (pair.isEmpty()) continue;
            String[] parts = pair.split("=", 2);
            out.put(decode(parts[0]), parts.length > 1 ? decode(parts[1]) : "");
        }
        return out;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static String httpDate(String iso) {
        return DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC).format(Instant.parse(iso));
    }
}
