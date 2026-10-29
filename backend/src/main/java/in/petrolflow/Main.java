package in.petrolflow;

import java.nio.file.Files;
import java.nio.file.Path;

public final class Main {
    private Main() {}

    public static void main(String[] args) throws Exception {
        Config config = Config.load();
        System.out.println("PetroFlow Java API — MySQL " + config.dbUser + "@" + config.dbHost + ":" + config.dbPort + "/" + config.dbName);
        Db.open(config);
        apply(config.mysqlDir().resolve("schema.sql"));
        seedIfEmpty(config);
        Web web = new Web(config);
        AuthRoutes.register(web);
        CatalogApi.register(web);
        ShiftApi.register(web);
        FinanceApi.register(web);
        ReportApi.register(web);
        OpsApi.register(web);
        web.listen();
    }

    private static void apply(Path file) throws Exception {
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

    private static void seedIfEmpty(Config config) throws Exception {
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
        System.out.println("Demo seed loaded (" + applied + " statements). Password: " + config.demoPassword);
    }
}
