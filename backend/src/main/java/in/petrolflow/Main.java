package in.petrolflow;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class Main {
    public static final long STARTED_AT_MS = System.currentTimeMillis();

    private Main() {}

    public static void main(String[] args) throws Exception {
        Set<String> flags = new HashSet<>(Arrays.asList(args));
        Config config = Config.load();
        System.out.println("PetroFlow Java API — MySQL " + config.dbUser + "@" + config.dbHost + ":" + config.dbPort + "/" + config.dbName);
        Db.open(config);
        if (flags.contains("--reset-db")) {
            resetDatabase(config);
        }
        apply(config.mysqlDir().resolve("schema.sql"));
        seedIfEmpty(config);
        if (flags.contains("--check-only") || flags.contains("--migrate-only")) {
            System.out.println("Database schema & seed check completed.");
            return;
        }
        Web web = buildWeb(config);
        web.listen();
    }

    public static Web buildWeb(Config config) {
        Web web = new Web(config);
        AuthRoutes.register(web);
        CatalogApi.register(web);
        ShiftApi.register(web);
        FinanceApi.register(web);
        ReportApi.register(web);
        OpsApi.register(web);
        return web;
    }

    public static void resetDatabase(Config config) {
        Db.exec("SET FOREIGN_KEY_CHECKS = 0");
        for (var row : Db.all("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?", config.dbName)) {
            String t = Db.str(row, "t");
            if (t != null && !t.isBlank()) {
                Db.exec("DROP TABLE IF EXISTS `" + t.replace("`", "``") + "`");
            }
        }
        Db.exec("SET FOREIGN_KEY_CHECKS = 1");
    }

    public static void apply(Path file) throws Exception {
        if (!Files.isRegularFile(file)) throw new IllegalStateException("Missing schema: " + file);
        int applied = 0;
        for (String statement : Mysql.split(Files.readString(file))) {
            String sql = statement.trim();
            if (sql.isEmpty()) continue;
            try {
                Db.exec(sql);
                applied++;
            } catch (RuntimeException error) {
                throw new IllegalStateException("Schema failed near: " + sql.substring(0, Math.min(160, sql.length())), error);
            }
        }
        System.out.println("Schema applied (" + applied + " statements) from " + file);
    }

    public static void seedIfEmpty(Config config) throws Exception {
        if (!config.seedDemo) return;
        if (Db.count("SELECT COUNT(*) AS count FROM users") > 0) {
            System.out.println("Seed skipped — users already exist");
            return;
        }
        Path seed = config.mysqlDir().resolve("seed.sql");
        if (!Files.isRegularFile(seed)) {
            System.out.println("Seed skipped — " + seed + " is missing");
            return;
        }
        Db.exec("SET FOREIGN_KEY_CHECKS = 0");
        String sql = Files.readString(seed).replaceAll("(?m)^SET\\s+.*$", "");
        int applied = 0;
        for (String statement : Mysql.split(sql)) {
            String trimmed = statement.trim();
            if (trimmed.isEmpty()) continue;
            Db.exec(trimmed);
            applied++;
        }
        Db.exec("SET FOREIGN_KEY_CHECKS = 1");
        String now = Clock.nowIso();
        Db.exec("UPDATE hardware_devices SET last_heartbeat_at = ?, last_sync_at = ? WHERE status = 'ONLINE'", now, now);
        System.out.println("Demo seed loaded (" + applied + " statements). Password: " + config.demoPassword);
    }
}
