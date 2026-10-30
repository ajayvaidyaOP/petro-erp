package in.petrolflow;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.function.Supplier;

public final class Db {
    private static final long IDLE_VALIDATION_THRESHOLD_MS = 30_000L;
    private static final int MAX_SERIALIZATION_RETRIES = 16;
    private static final ThreadLocal<Mysql> PINNED = new ThreadLocal<>();
    private static volatile MysqlPool pool;

    private Db() {}

    public static synchronized void open(Config config) {
        close();
        MysqlPool next = new MysqlPool(
                config.dbHost,
                config.dbPort,
                config.dbName,
                config.dbUser,
                config.dbPassword,
                config.dbPoolMaxSize,
                config.dbConnectTimeoutMs,
                config.dbSocketTimeoutMs,
                config.dbPoolAcquireTimeoutMs);
        next.bootstrap();
        pool = next;
    }

    public static List<Map<String, Object>> all(String sql, Object... params) {
        return executeOnConnection(conn -> conn.all(sql, params));
    }

    public static Map<String, Object> one(String sql, Object... params) {
        return executeOnConnection(conn -> conn.one(sql, params));
    }

    public static long count(String sql, Object... params) {
        return executeOnConnection(conn -> conn.count(sql, params));
    }

    public static int exec(String sql, Object... params) {
        return executeOnConnection(conn -> conn.exec(sql, params));
    }

    /**
     * Acquires a MySQL named advisory lock ({@code GET_LOCK}) on the current connection.
     *
     * <p>Named locks are server-side, so they are honoured by every API process that shares the
     * database — unlike a JVM lock. They are released automatically when the session ends, so a
     * crashed process cannot wedge them. Callers must run inside {@link #withConnection} (so the same
     * session is pinned) and must call {@link #releaseLock} in a {@code finally} block.
     *
     * @return true when the lock was acquired within {@code timeoutSeconds}
     */
    public static boolean acquireLock(String name, int timeoutSeconds) {
        Map<String, Object> row = Db.one("SELECT GET_LOCK(?, ?) AS acquired", name, Math.max(0, timeoutSeconds));
        return row != null && num(row, "acquired") == 1;
    }

    /** Releases a named advisory lock held by the current connection. Never throws. */
    public static void releaseLock(String name) {
        try {
            Db.one("SELECT RELEASE_LOCK(?) AS released", name);
        } catch (RuntimeException ignored) {
            /* the lock is released by MySQL when the session ends */
        }
    }

    public static <T> T withConnection(Supplier<T> work) {
        Mysql pinned = PINNED.get();
        if (pinned != null) {
            return work.get();
        }
        MysqlPool activePool = requirePool();
        Mysql borrowed = activePool.borrow();
        PINNED.set(borrowed);
        try {
            return work.get();
        } finally {
            PINNED.remove();
            activePool.release(borrowed);
        }
    }

    public static void withConnectionVoid( ThrowingRunnable work) {
        withConnection(() -> {
            try {
                work.run();
                return null;
            } catch (RuntimeException | Error e) {
                throw e;
            } catch (Exception checked) {
                throw new CheckedWrapper(checked);
            }
        });
    }

    public static <T> T tx(Supplier<T> work) {
        Mysql pinned = PINNED.get();
        if (pinned != null) {
            return pinned.tx(work);
        }
        for (int attempt = 1; ; attempt++) {
            try {
                return withConnection(() -> PINNED.get().tx(work));
            } catch (ApiException ex) {
                if ("DB_DEADLOCK".equals(ex.code) && attempt < MAX_SERIALIZATION_RETRIES) {
                    sleepBackoff(attempt);
                    continue;
                }
                throw ex;
            }
        }
    }

    public static void script(String sql) {
        withConnection(() -> {
            PINNED.get().script(sql);
            return null;
        });
    }

    public static synchronized void close() {
        PINNED.remove();
        MysqlPool current = pool;
        pool = null;
        if (current != null) {
            current.close();
        }
    }

    public static int poolMaxSize() {
        MysqlPool current = pool;
        return current == null ? 0 : current.maxSize;
    }

    public static int poolActiveCount() {
        MysqlPool current = pool;
        return current == null ? 0 : current.activeCount();
    }

    public static int poolIdleCount() {
        MysqlPool current = pool;
        return current == null ? 0 : current.idleCount();
    }

    public static int poolCreatedCount() {
        MysqlPool current = pool;
        return current == null ? 0 : current.createdCount();
    }

    public static String str(Map<String, Object> row, String key) {
        if (row == null) return null;
        Object value = row.get(key);
        return value == null ? null : String.valueOf(value);
    }

    public static long num(Map<String, Object> row, String key) {
        if (row == null || row.get(key) == null) return 0;
        Object value = row.get(key);
        if (value instanceof Number number) return number.longValue();
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static <T> T executeOnConnection(Function<Mysql, T> action) {
        Mysql pinned = PINNED.get();
        if (pinned != null) {
            return action.apply(pinned);
        }
        MysqlPool activePool = requirePool();
        Mysql borrowed = activePool.borrow();
        try {
            return action.apply(borrowed);
        } finally {
            activePool.release(borrowed);
        }
    }

    private static MysqlPool requirePool() {
        MysqlPool current = pool;
        if (current == null || current.closed.get()) {
            throw new ApiException(503, "DB_UNAVAILABLE", "Database pool is not initialized");
        }
        return current;
    }

    private static void sleepBackoff(int attempt) {
        long delayMs = Math.min(80L, (1L << attempt) * 4L + ThreadLocalRandom.current().nextInt(1, 12));
        try {
            Thread.sleep(delayMs);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new ApiException(503, "DB_UNAVAILABLE", "Interrupted during transaction retry");
        }
    }

    @FunctionalInterface
    public interface ThrowingRunnable {
        void run() throws Exception;
    }

    static final class CheckedWrapper extends RuntimeException {
        final Exception causeException;

        CheckedWrapper(Exception causeException) {
            super(causeException);
            this.causeException = causeException;
        }
    }

    private static final class MysqlPool {
        private final String host;
        private final int port;
        private final String database;
        private final String user;
        private final String password;
        private final int maxSize;
        private final int connectTimeoutMs;
        private final int socketTimeoutMs;
        private final int acquireTimeoutMs;
        private final Semaphore permits;
        private final ConcurrentLinkedDeque<Mysql> idle = new ConcurrentLinkedDeque<>();
        private final Set<Mysql> tracked = ConcurrentHashMap.newKeySet();
        private final AtomicInteger created = new AtomicInteger();
        private final AtomicBoolean closed = new AtomicBoolean(false);

        MysqlPool(
                String host,
                int port,
                String database,
                String user,
                String password,
                int maxSize,
                int connectTimeoutMs,
                int socketTimeoutMs,
                int acquireTimeoutMs) {
            this.host = host;
            this.port = port;
            this.database = database;
            this.user = user;
            this.password = password;
            this.maxSize = maxSize;
            this.connectTimeoutMs = connectTimeoutMs;
            this.socketTimeoutMs = socketTimeoutMs;
            this.acquireTimeoutMs = acquireTimeoutMs;
            this.permits = new Semaphore(maxSize, true);
        }

        void bootstrap() {
            Mysql initial = newConnection();
            try {
                initial.connect();
                tracked.add(initial);
                created.incrementAndGet();
                idle.offerFirst(initial);
            } catch (Throwable error) {
                initial.close();
                throw error;
            }
        }

        Mysql borrow() {
            if (closed.get()) {
                throw new ApiException(503, "DB_UNAVAILABLE", "Database connection pool is closed");
            }
            final boolean acquired;
            try {
                acquired = permits.tryAcquire(acquireTimeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new ApiException(503, "DB_UNAVAILABLE", "Interrupted while waiting for a database connection");
            }
            if (!acquired) {
                throw new ApiException(503, "DB_POOL_EXHAUSTED", "Database connection pool timed out after " + acquireTimeoutMs + " ms");
            }
            if (closed.get()) {
                permits.release();
                throw new ApiException(503, "DB_UNAVAILABLE", "Database connection pool is closed");
            }

            Mysql conn = idle.pollFirst();
            try {
                if (conn == null) {
                    conn = newConnection();
                    conn.connectToExistingDatabase();
                    tracked.add(conn);
                    created.incrementAndGet();
                } else {
                    conn.validateOrReconnect(IDLE_VALIDATION_THRESHOLD_MS);
                }
                return conn;
            } catch (Throwable error) {
                if (conn != null) {
                    tracked.remove(conn);
                    conn.close();
                }
                permits.release();
                throw error;
            }
        }

        void release(Mysql conn) {
            try {
                if (conn == null) return;
                if (closed.get()) {
                    tracked.remove(conn);
                    conn.close();
                    return;
                }
                conn.resetSessionForPool();
                if (conn.isOpen()) {
                    idle.offerFirst(conn);
                } else {
                    tracked.remove(conn);
                    conn.close();
                }
            } finally {
                permits.release();
            }
        }

        int activeCount() {
            return maxSize - permits.availablePermits();
        }

        int idleCount() {
            return idle.size();
        }

        int createdCount() {
            return created.get();
        }

        void close() {
            if (!closed.compareAndSet(false, true)) return;
            Mysql c;
            while ((c = idle.pollFirst()) != null) {
                tracked.remove(c);
                c.close();
            }
            for (Mysql remaining : tracked) {
                remaining.close();
            }
            tracked.clear();
        }

        private Mysql newConnection() {
            return new Mysql(host, port, database, user, password, connectTimeoutMs, socketTimeoutMs);
        }
    }
}
