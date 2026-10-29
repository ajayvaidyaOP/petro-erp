package in.petrolflow;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

public final class Db {
    private static Mysql mysql;

    private Db() {}

    public static void open(Config config) {
        mysql = new Mysql(config.dbHost, config.dbPort, config.dbName, config.dbUser, config.dbPassword);
        mysql.connect();
    }

    public static List<Map<String, Object>> all(String sql, Object... params) {
        return mysql.all(sql, params);
    }

    public static Map<String, Object> one(String sql, Object... params) {
        return mysql.one(sql, params);
    }

    public static long count(String sql, Object... params) {
        return mysql.count(sql, params);
    }

    public static int exec(String sql, Object... params) {
        return mysql.exec(sql, params);
    }

    public static <T> T tx(Supplier<T> work) {
        return mysql.tx(work);
    }

    public static void script(String sql) {
        mysql.script(sql);
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
}
