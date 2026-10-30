package in.petrolflow;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

public final class Config {
    public final String env;
    public final boolean production;
    public final boolean demoTools;
    public final boolean seedDemo;
    public final String demoPassword;
    public final String host;
    public final int port;
    public final String dbHost;
    public final int dbPort;
    public final String dbName;
    public final String dbUser;
    public final String dbPassword;
    public final int dbPoolMaxSize;
    public final int dbConnectTimeoutMs;
    public final int dbSocketTimeoutMs;
    public final int dbPoolAcquireTimeoutMs;
    public final int idempotencyLeaseSeconds;
    public final String cookieName;
    public final int sessionHours;
    public final boolean cookieSecure;
    public final Path root;
    public final String sandboxId;
    public final String appOrigin;
    public final java.util.Set<String> allowedOrigins;

    private Config(Map<String, String> env, Path root) {
        this.root = root;
        this.env = str(env, "NODE_ENV", "development");
        this.production = "production".equals(this.env);
        this.demoTools = bool(env, "ENABLE_DEMO_TOOLS", !production);
        this.seedDemo = bool(env, "SEED_DEMO_DATA", true);
        this.demoPassword = str(env, "DEMO_PASSWORD", "PetroFlow@2025");
        this.host = str(env, "HOST", "0.0.0.0");
        this.port = num(env, "PORT", 4000);
        this.dbHost = str(env, "PETROFLOW_DB_HOST", str(env, "MYSQL_HOST", "127.0.0.1"));
        this.dbPort = num(env, "PETROFLOW_DB_PORT", num(env, "MYSQL_PORT", 3306));
        this.dbName = str(env, "PETROFLOW_DB_NAME", str(env, "MYSQL_DATABASE", "petroflow"));
        this.dbUser = str(env, "PETROFLOW_DB_USER", str(env, "MYSQL_USER", "root"));
        this.dbPassword = str(env, "PETROFLOW_DB_PASSWORD", str(env, "MYSQL_PASSWORD", ""));
        this.dbPoolMaxSize = clamp(num(env, "PETROFLOW_DB_POOL_MAX", num(env, "MYSQL_POOL_MAX", 10)), 2, 64);
        this.dbConnectTimeoutMs = clamp(num(env, "PETROFLOW_DB_CONNECT_TIMEOUT_MS", 8_000), 1_000, 60_000);
        this.dbSocketTimeoutMs = clamp(num(env, "PETROFLOW_DB_SOCKET_TIMEOUT_MS", 30_000), 2_000, 120_000);
        this.dbPoolAcquireTimeoutMs = clamp(num(env, "PETROFLOW_DB_POOL_TIMEOUT_MS", 10_000), 1_000, 60_000);
        this.idempotencyLeaseSeconds = clamp(
                num(env, "PETROFLOW_IDEMPOTENCY_LEASE_SECONDS", 90),
                this.production ? 60 : 2,
                this.production ? 120 : 300);
        this.cookieName = str(env, "SESSION_COOKIE_NAME", "pf_session");
        this.sessionHours = num(env, "SESSION_TTL_HOURS", 12);
        this.cookieSecure = bool(env, "COOKIE_SECURE", production);
        this.sandboxId = System.getenv("E2B_SANDBOX_ID");
        this.appOrigin = str(env, "APP_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174");
        java.util.Set<String> origins = new java.util.LinkedHashSet<>();
        for (String item : this.appOrigin.split(",")) {
            String trimmed = item.trim();
            if (!trimmed.isEmpty()) origins.add(trimmed);
        }
        this.allowedOrigins = java.util.Collections.unmodifiableSet(origins);
    }

    public static Config load() {
        return load(Map.of());
    }

    public static Config load(Map<String, String> overrides) {
        Path root = findRoot();
        Map<String, String> env = new HashMap<>();
        loadFile(root.resolve(".env"), env);
        loadFile(root.resolve("backend").resolve(".env"), env);
        System.getenv().forEach(env::put);
        if (overrides != null) env.putAll(overrides);
        return new Config(env, root);
    }

    public Path mysqlDir() {
        return root.resolve("backend").resolve("db").resolve("mysql");
    }

    private static Path findRoot() {
        Path dir = Path.of(System.getProperty("user.dir", ".")).toAbsolutePath();
        for (int i = 0; i < 5 && dir != null; i++) {
            if (Files.isRegularFile(dir.resolve("backend").resolve("db").resolve("mysql").resolve("schema.sql"))) return dir;
            if (Files.isRegularFile(dir.resolve("db").resolve("mysql").resolve("schema.sql")) && Files.isDirectory(dir.resolve("src"))) {
                return dir.getParent() == null ? dir : dir.getParent();
            }
            dir = dir.getParent();
        }
        return Path.of(System.getProperty("user.dir", ".")).toAbsolutePath();
    }

    private static void loadFile(Path file, Map<String, String> env) {
        if (!Files.isRegularFile(file)) return;
        try {
            for (String line : Files.readAllLines(file)) {
                String trimmed = line.trim();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) continue;
                int eq = trimmed.indexOf('=');
                if (eq <= 0) continue;
                String key = trimmed.substring(0, eq).trim();
                String value = trimmed.substring(eq + 1).trim();
                if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length() - 1);
                }
                env.putIfAbsent(key, value);
            }
        } catch (IOException ignored) {
            /* missing env file is fine */
        }
    }

    private static String str(Map<String, String> env, String key, String fallback) {
        String value = env.get(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static int num(Map<String, String> env, String key, int fallback) {
        try {
            return Integer.parseInt(str(env, key, String.valueOf(fallback)));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static boolean bool(Map<String, String> env, String key, boolean fallback) {
        String value = env.get(key);
        if (value == null || value.isBlank()) return fallback;
        return value.equals("1") || value.equalsIgnoreCase("true") || value.equalsIgnoreCase("yes") || value.equalsIgnoreCase("on");
    }
}
