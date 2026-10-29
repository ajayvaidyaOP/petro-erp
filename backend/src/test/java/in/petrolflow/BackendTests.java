package in.petrolflow;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Pure Java 21 unit + MySQL 8 HTTP integration test suite for PetroFlow ERP.
 */
public final class BackendTests {
    private static int passed = 0;

    private BackendTests() {}

    public static void main(String[] args) throws Exception {
        System.out.println("Running PetroFlow Java 21 backend verification suite...");
        testMoneyAndJson();
        testPasswordsAndPermissions();
        if (!Boolean.parseBoolean(System.getenv().getOrDefault("SKIP_DB_TESTS", "false"))) {
            testHttpAndDatabaseIntegration();
        }
        System.out.println("ALL " + passed + " JAVA BACKEND ASSERTIONS PASSED.");
        System.exit(0);
    }

    private static void testMoneyAndJson() {
        check("123.46".equals(Money.money("123.456")), "Money.money 2dp rounding");
        check("45.500".equals(Money.litres("45.5")), "Money.litres 3dp formatting");
        check("104.650".equals(Money.rate("104.65")), "Money.rate 3dp formatting");
        check("25.0".equals(Money.percent(new BigDecimal("250"), "1000", 1)), "Money.percent calculation");
        check(Clock.todayIst().matches("\\d{4}-\\d{2}-\\d{2}"), "Clock.todayIst ISO format");
        check("2026-10-30".equals(Clock.addDays("2026-10-29", 1)), "Clock.addDays");

        Map<String, Object> row = Web.map("station_id", "stn_1", "total_value", "500.00", "features", "[\"A\",\"B\"]");
        Map<String, Object> shaped = Json.shape(row, List.of("features"));
        check("stn_1".equals(shaped.get("stationId")), "Json.shape snake_case -> camelCase");
        check(shaped.get("features") instanceof List<?> list && list.size() == 2, "Json.shape JSON column parsing");
        String encoded = Json.stringify(shaped);
        Map<String, Object> roundTrip = Json.object(Json.parse(encoded));
        check("500.00".equals(roundTrip.get("totalValue")), "Json parse/stringify round-trip");
    }

    private static void testPasswordsAndPermissions() {
        String hashed = Passwords.hash("PetroFlow@2025");
        check(hashed.startsWith("pbkdf2$"), "PBKDF2 prefix");
        check(Passwords.verify("PetroFlow@2025", hashed), "PBKDF2 valid password verify");
        check(!Passwords.verify("WrongPassword1", hashed), "PBKDF2 invalid password reject");

        List<String> ownerPerms = Permissions.forRole("OWNER");
        check(ownerPerms.contains("employees.write") && !ownerPerms.contains("platform.manage"), "Owner permissions");
        List<String> staffClean = Permissions.sanitize(List.of("sales.read", "platform.manage", "employees.write", "unknown.perm"));
        check(staffClean.equals(List.of("sales.read")), "Staff permission sanitization blocks escalations");
    }

    @SuppressWarnings("unchecked")
    private static void testHttpAndDatabaseIntegration() throws Exception {
        int testPort = Integer.parseInt(System.getenv().getOrDefault("TEST_API_PORT", "4199"));
        Config base = Config.load(Map.of("PORT", String.valueOf(testPort)));
        Db.open(base);
        Main.resetDatabase(base);
        Main.apply(base.mysqlDir().resolve("schema.sql"));
        Main.seedIfEmpty(base);

        Web web = Main.buildWeb(base);
        web.listen();
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
            String url = "http://127.0.0.1:" + testPort + "/api/v1";

            // 1. Health check
            HttpResponse<String> health = get(client, url + "/health", null);
            check(health.statusCode() == 200, "GET /health returns 200");

            // 2. Bad login -> 401
            HttpResponse<String> badLogin = post(client, url + "/auth/login", null, Map.of("email", "owner@sunrisefuels.in", "password", "bad"));
            check(badLogin.statusCode() == 401, "POST /auth/login rejects wrong password with 401");

            // 3. Valid owner login + preview cookie check
            HttpRequest previewLoginReq = HttpRequest.newBuilder(URI.create(url + "/auth/login"))
                    .header("Content-Type", "application/json")
                    .header("X-Forwarded-Host", "5173-sandbox.e2b.app")
                    .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(Map.of("email", "owner@sunrisefuels.in", "password", base.demoPassword))))
                    .build();
            HttpResponse<String> loginRes = client.send(previewLoginReq, HttpResponse.BodyHandlers.ofString());
            check(loginRes.statusCode() == 200, "POST /auth/login accepts valid demo owner");
            String setCookie = loginRes.headers().firstValue("Set-Cookie").orElse("");
            check(setCookie.contains("SameSite=None") && setCookie.contains("Secure") && !setCookie.contains("Partitioned"),
                    "Preview Set-Cookie uses SameSite=None; Secure without Partitioned");

            Map<String, Object> loginData = Json.object(Json.object(Json.parse(loginRes.body())).get("data"));
            String ownerToken = String.valueOf(loginData.get("sessionToken"));
            check(ownerToken != null && ownerToken.length() > 20, "sessionToken issued in non-production");

            // 4. /auth/me & stations
            HttpResponse<String> meRes = get(client, url + "/auth/me", ownerToken);
            check(meRes.statusCode() == 200, "GET /auth/me returns 200 with Bearer sessionToken");
            Map<String, Object> meData = Json.object(Json.object(Json.parse(meRes.body())).get("data"));
            List<?> stations = (List<?>) meData.get("stations");
            check(stations != null && stations.size() >= 2, "Demo owner has 2 stations");
            String stationId = String.valueOf(Json.object(stations.get(0)).get("id"));

            // 5. DSR & Combined CSV export (`stationId=all`)
            HttpResponse<String> dsrRes = get(client, url + "/reports/dsr?stationId=" + stationId + "&date=2026-10-29", ownerToken);
            check(dsrRes.statusCode() == 200, "GET /reports/dsr returns 200");
            Map<String, Object> dsrData = Json.object(Json.object(Json.parse(dsrRes.body())).get("data"));
            check(dsrData.get("transactions") instanceof List<?> && dsrData.get("deliveries") instanceof List<?>,
                    "DSR includes transactions and deliveries arrays for combined DSR merge");

            HttpResponse<String> csvAll = get(client, url + "/reports/export/sales-register.csv?stationId=all&month=2026-10", ownerToken);
            check(csvAll.statusCode() == 200 && csvAll.body().startsWith("station,date,shift,product,litres,amount"),
                    "Sales register CSV supports stationId=all");

            // 6. Device registration (`pfk_` prefix + `isSimulated: false`) & Gateway ingestion idempotency
            HttpResponse<String> devRes = post(client, url + "/devices", ownerToken, Web.map(
                    "stationId", stationId,
                    "code", "GW-JAVA-TEST",
                    "name", "Java Test Controller",
                    "type", "CONTROLLER",
                    "isSimulated", false));
            check(devRes.statusCode() == 201, "POST /devices creates device (201)");
            Map<String, Object> devData = Json.object(Json.object(Json.parse(devRes.body())).get("data"));
            String apiKey = String.valueOf(devData.get("apiKey"));
            check(apiKey.startsWith("pfk_"), "Issued device API key starts with pfk_");
            check("0".equals(String.valueOf(devData.get("isSimulated"))), "Real device has isSimulated = 0");

            HttpRequest gwEvReq = HttpRequest.newBuilder(URI.create(url + "/gateway/events"))
                    .header("Content-Type", "application/json")
                    .header("X-Device-Key", apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(Web.map("events", List.of(Web.map(
                            "eventId", "ev_fixed_001",
                            "eventType", "HEARTBEAT",
                            "sequence", 1,
                            "payload", Web.map("ok", true)))))))
                    .build();
            HttpResponse<String> gwFirst = client.send(gwEvReq, HttpResponse.BodyHandlers.ofString());
            HttpResponse<String> gwDup = client.send(gwEvReq, HttpResponse.BodyHandlers.ofString());
            check(gwFirst.statusCode() == 200 && gwDup.statusCode() == 200, "Gateway events endpoint is idempotent");
            Map<String, Object> dupData = Json.object(Json.object(Json.parse(gwDup.body())).get("data"));
            check("1".equals(String.valueOf(dupData.get("duplicates"))), "Duplicate eventId counted as duplicate");

            // 7. RBAC: Owner cannot access /admin/metrics (403), Super Admin can (200)
            HttpResponse<String> forbiddenAdmin = get(client, url + "/admin/metrics", ownerToken);
            check(forbiddenAdmin.statusCode() == 403, "Tenant owner blocked from /admin/metrics (403)");

            HttpResponse<String> saLogin = post(client, url + "/auth/login", null, Map.of("email", "superadmin@petroflow.dev", "password", base.demoPassword));
            String saToken = String.valueOf(Json.object(Json.object(Json.parse(saLogin.body())).get("data")).get("sessionToken"));
            check(get(client, url + "/admin/metrics", saToken).statusCode() == 200, "Super admin accesses /admin/metrics (200)");
            check(get(client, url + "/admin/audit", saToken).statusCode() == 200, "Super admin accesses /admin/audit (200)");
            check(get(client, url + "/admin/plans", saToken).statusCode() == 200, "Super admin accesses /admin/plans (200)");

            // Reset clean demo seed at end of test run
            Main.resetDatabase(base);
            Main.apply(base.mysqlDir().resolve("schema.sql"));
            Main.seedIfEmpty(base);
        } finally {
            web.stop();
            Db.close();
        }
    }

    private static HttpResponse<String> get(HttpClient client, String uri, String token) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(uri)).GET();
        if (token != null) b.header("Authorization", "Bearer " + token);
        return client.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static HttpResponse<String> post(HttpClient client, String uri, String token, Object body) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(uri))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(body)));
        if (token != null) b.header("Authorization", "Bearer " + token);
        return client.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError("FAILED: " + label);
        passed++;
        System.out.println("  [OK] " + label);
    }
}
