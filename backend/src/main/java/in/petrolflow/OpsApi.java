package in.petrolflow;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Settings, attendance, density, compliance, lubricants, devices, readings and platform admin. */
public final class OpsApi {
    private OpsApi() {}

    public static void register(Web web) {
        web.get("/audit", OpsApi::audit);
        web.get("/settings", OpsApi::settings);
        web.put("/settings", OpsApi::saveSettings);
        web.get("/settings/diagnostics", OpsApi::diagnostics);
        web.get("/settings/subscription", OpsApi::subscription);
        web.get("/attendance", OpsApi::attendance);
        web.get("/attendance/summary", OpsApi::attendanceSummary);
        web.post("/attendance/mark", OpsApi::markAttendance);
        web.get("/density", OpsApi::density);
        web.post("/density", OpsApi::addDensity);
        web.delete("/density/:id", OpsApi::deleteDensity);
        web.get("/compliance", OpsApi::compliance);
        web.post("/compliance", OpsApi::addCompliance);
        web.patch("/compliance/:id", OpsApi::patchCompliance);
        web.delete("/compliance/:id", OpsApi::deleteCompliance);
        web.get("/lubricants", OpsApi::lubricants);
        web.post("/lubricants", OpsApi::addLubricant);
        web.patch("/lubricants/:id", OpsApi::patchLubricant);
        web.get("/lubricants/movements", OpsApi::lubeMovements);
        web.post("/lubricants/movements", OpsApi::addLubeMovement);
        web.get("/devices", OpsApi::devices);
        web.get("/devices/:id/events", OpsApi::deviceEvents);
        web.post("/devices", OpsApi::addDevice);
        web.patch("/devices/:id", OpsApi::patchDevice);
        web.post("/devices/:id/rotate-key", OpsApi::rotateKey);
        web.post("/devices/:id/events/:eventId/replay", OpsApi::replay);
        web.get("/hardware/diagnostics", OpsApi::hardwareDiagnostics);
        web.get("/readings", OpsApi::readings);
        web.post("/readings/manual", OpsApi::manualReading);
        web.post("/demo/simulate", OpsApi::simulate);
        web.get("/admin/metrics", OpsApi::metrics);
        web.get("/admin/plans", OpsApi::plans);
        web.post("/admin/plans", OpsApi::addPlan);
        web.patch("/admin/plans/:id", OpsApi::patchPlan);
        web.get("/admin/tenants", OpsApi::tenants);
        web.post("/admin/tenants", OpsApi::addTenant);
        web.get("/admin/tenants/:id", OpsApi::tenant);
        web.patch("/admin/tenants/:id", OpsApi::patchTenant);
        web.post("/admin/tenants/:id/subscription", OpsApi::setSubscription);
        web.post("/admin/tenants/:id/invoices", OpsApi::addInvoice);
        web.get("/admin/subscriptions", OpsApi::subscriptions);
        web.get("/admin/invoices", OpsApi::invoices);
        web.post("/admin/invoices/:id/mark-paid", OpsApi::markPaid);
        web.get("/admin/stations", OpsApi::adminStations);
        web.post("/admin/stations", OpsApi::addStation);
        web.patch("/admin/stations/:id", OpsApi::patchStation);
        web.get("/admin/devices", OpsApi::adminDevices);
        web.get("/admin/errors", OpsApi::errors);
        web.patch("/admin/errors/:id/resolve", OpsApi::resolveError);
    }

    private static void audit(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("audit.read");
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        long total = Db.count("SELECT COUNT(*) AS count FROM audit_logs WHERE tenant_id = ?", auth.tenantId());
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?", auth.tenantId(), size, (page - 1) * size)), Domain.page(total, page, size));
    }

    private static void settings(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("settings.read");
        String stationId = ctx.q("stationId");
        if (stationId != null) auth.station(stationId);
        Map<String, String> defaults = defaults();
        Map<String, Object> effective = new LinkedHashMap<>();
        Map<String, Object> stored = new LinkedHashMap<>();
        for (var entry : defaults.entrySet()) {
            String value = Domain.setting(entry.getKey(), auth.tenantId(), stationId, entry.getValue());
            stored.put(entry.getKey(), value);
            effective.put(entry.getKey(), coerce(entry.getKey(), value));
        }
        ctx.ok(Map.of("settings", stored, "effective", effective, "schema", schema()));
    }

    private static void saveSettings(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("settings.write");
        String stationId = ctx.str("stationId");
        if (stationId != null) auth.station(stationId);
        Map<String, Object> values = Json.object(ctx.body().get("values") == null ? ctx.body().get("settings") : ctx.body().get("values"));
        if (values.isEmpty()) values = ctx.body();
        for (var entry : values.entrySet()) {
            if (!defaults().containsKey(entry.getKey()) || "stationId".equals(entry.getKey())) continue;
            String value = String.valueOf(entry.getValue());
            String scopeStation = "station".equals(schema().get(entry.getKey()).get("scope")) ? (stationId == null ? "" : stationId) : "";
            Map<String, Object> existing = Db.one("SELECT id FROM app_settings WHERE tenant_id = ? AND station_id = ? AND `key` = ?", auth.tenantId(), scopeStation, entry.getKey());
            if (existing == null) {
                Db.exec("INSERT INTO app_settings (id, tenant_id, station_id, `key`, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        Clock.newId("stg"), auth.tenantId(), scopeStation, entry.getKey(), value, auth.userId, Clock.nowIso());
            } else {
                Db.exec("UPDATE app_settings SET value = ?, updated_by = ?, updated_at = ? WHERE id = ?", value, auth.userId, Clock.nowIso(), existing.get("id"));
            }
        }
        settings(ctx);
    }

    private static void diagnostics(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("settings.read");
        Map<String, Object> application = new LinkedHashMap<>();
        application.put("name", "PetroFlow");
        application.put("version", "1.0.0");
        application.put("apiVersion", "v1");
        application.put("environment", ctx.config.env);
        application.put("nodeVersion", "java");
        application.put("platform", "java");
        application.put("uptimeSeconds", 0);
        application.put("serverTime", Clock.nowIso());
        application.put("timezone", "Asia/Kolkata");
        Map<String, Object> database = new LinkedHashMap<>();
        database.put("engine", "MySQL");
        database.put("file", ctx.config.dbName + "@" + ctx.config.dbHost);
        database.put("sizeBytes", 0);
        database.put("tenants", Db.count("SELECT COUNT(*) AS count FROM tenants"));
        database.put("stations", Db.count("SELECT COUNT(*) AS count FROM stations"));
        database.put("users", Db.count("SELECT COUNT(*) AS count FROM users"));
        database.put("tanks", Db.count("SELECT COUNT(*) AS count FROM tanks"));
        database.put("nozzles", Db.count("SELECT COUNT(*) AS count FROM nozzles"));
        database.put("meterReadings", Db.count("SELECT COUNT(*) AS count FROM meter_readings"));
        database.put("shifts", Db.count("SELECT COUNT(*) AS count FROM shifts"));
        database.put("creditEntries", Db.count("SELECT COUNT(*) AS count FROM credit_entries"));
        database.put("payments", Db.count("SELECT COUNT(*) AS count FROM payments"));
        database.put("auditLogs", Db.count("SELECT COUNT(*) AS count FROM audit_logs"));
        ctx.ok(Map.of(
                "application", application,
                "database", database,
                "hardware", Map.of("devices", Map.of(), "eventStates", Map.of(), "onlineWindowMinutes", 5, "adapterContractVersion", "1", "simulatorEnabled", ctx.config.demoTools, "realHardwareVerified", false, "note", "Simulated data only until tested against a compatible forecourt controller."),
                "security", Map.of("sessionsAreServerSide", true, "sessionCookie", ctx.config.cookieName, "cookieSecure", ctx.config.cookieSecure, "sessionTtlHours", ctx.config.sessionHours, "passwordHashing", "PBKDF2-HMAC-SHA256", "rateLimiting", "in-process", "demoPasswordInUse", ctx.config.demoTools, "demoPasswordWarning", "Demo credentials are for local evaluation only."),
                "environment", Map.of("demoMode", ctx.config.demoTools, "seedDemoData", ctx.config.seedDemo, "trustProxy", true, "corsOrigin", "preview", "backupRetentionDays", 14),
                "operations", Map.of("backup", "mysqldump", "restore", "mysql client", "migrations", "backend/db/mysql/schema.sql")));
    }

    private static void subscription(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("billing.read");
        Map<String, Object> row = Json.shape(Db.one(
                """
                SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.monthly_price, p.annual_price, p.max_stations, p.max_users, p.max_dispensers, p.features, p.trial_days
                  FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
                 WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1
                """, auth.tenantId()), List.of("features"));
        List<Map<String, Object>> invoices = Json.shapeAll(Db.all("SELECT * FROM subscription_invoices WHERE tenant_id = ? ORDER BY issued_at DESC", auth.tenantId()));
        BigDecimal outstanding = BigDecimal.ZERO;
        for (Map<String, Object> invoice : invoices) {
            if (!"PAID".equals(invoice.get("status"))) outstanding = outstanding.add(Money.d(invoice.get("totalAmount")));
        }
        ctx.ok(Map.of(
                "subscription", row == null ? Map.of() : row,
                "invoices", invoices,
                "usage", Map.of(
                        "stations", Db.count("SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?", auth.tenantId()),
                        "users", Db.count("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND status = 'ACTIVE'", auth.tenantId()),
                        "dispensers", Db.count("SELECT COUNT(*) AS count FROM dispensers d JOIN stations s ON s.id = d.station_id WHERE s.tenant_id = ?", auth.tenantId())),
                "outstanding", Money.money(outstanding),
                "note", "Subscription billing is recorded here. Payment collection is manual."));
    }

    private static void attendance(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("attendance.read");
        Map<String, Object> station = auth.station(required(ctx));
        String date = Domain.requireDate(ctx.q("date"), "Date");
        List<Map<String, Object>> employees = new ArrayList<>();
        for (Map<String, Object> user : Db.all("SELECT id, name, email, role_key FROM users WHERE tenant_id = ? AND status = 'ACTIVE' AND role_key IN ('OWNER','MANAGER','STAFF') ORDER BY name", auth.tenantId())) {
            Map<String, Object> mark = Db.one("SELECT status, in_time, out_time FROM attendance_records WHERE user_id = ? AND attendance_date = ?", user.get("id"), date);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("userId", user.get("id"));
            row.put("name", user.get("name"));
            row.put("email", user.get("email"));
            row.put("roleKey", user.get("role_key"));
            row.put("status", mark == null ? null : mark.get("status"));
            row.put("inTime", mark == null ? null : mark.get("in_time"));
            row.put("outTime", mark == null ? null : mark.get("out_time"));
            employees.add(row);
        }
        ctx.ok(Map.of("stationId", station.get("id"), "date", date, "employees", employees));
    }

    private static void attendanceSummary(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("attendance.read");
        auth.station(required(ctx));
        String month = ctx.q("month") == null ? Clock.todayIst().substring(0, 7) : ctx.q("month");
        List<Map<String, Object>> employees = new ArrayList<>();
        for (Map<String, Object> user : Db.all("SELECT id, name, role_key FROM users WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY name", auth.tenantId())) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("userId", user.get("id"));
            row.put("name", user.get("name"));
            row.put("roleKey", user.get("role_key"));
            row.put("present", countStatus(Db.str(user, "id"), month, "PRESENT"));
            row.put("absent", countStatus(Db.str(user, "id"), month, "ABSENT"));
            row.put("halfDay", countStatus(Db.str(user, "id"), month, "HALF_DAY"));
            row.put("weekOff", countStatus(Db.str(user, "id"), month, "WEEK_OFF"));
            row.put("leave", countStatus(Db.str(user, "id"), month, "LEAVE"));
            row.put("payableDays", countStatus(Db.str(user, "id"), month, "PRESENT") + countStatus(Db.str(user, "id"), month, "HALF_DAY") * 0.5);
            employees.add(row);
        }
        ctx.ok(Map.of("month", month, "employees", employees));
    }

    private static void markAttendance(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("attendance.write");
        Map<String, Object> station = auth.station(ctx.str("stationId"));
        String date = Domain.requireDate(ctx.str("date"), "Date");
        Object entries = ctx.body().get("entries");
        if (entries instanceof List<?> list) {
            for (Object item : list) {
                Map<String, Object> entry = Json.object(item);
                String userId = String.valueOf(entry.get("userId"));
                String status = String.valueOf(entry.get("status"));
                Map<String, Object> existing = Db.one("SELECT id FROM attendance_records WHERE user_id = ? AND attendance_date = ?", userId, date);
                if (existing == null) {
                    Db.exec(
                            "INSERT INTO attendance_records (id, tenant_id, station_id, user_id, attendance_date, status, in_time, out_time, marked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            Clock.newId("att"), auth.tenantId(), station.get("id"), userId, date, status, entry.get("inTime"), entry.get("outTime"), auth.userId, Clock.nowIso(), Clock.nowIso());
                } else {
                    Db.exec("UPDATE attendance_records SET status = ?, in_time = ?, out_time = ?, marked_by = ?, updated_at = ? WHERE id = ?",
                            status, entry.get("inTime"), entry.get("outTime"), auth.userId, Clock.nowIso(), existing.get("id"));
                }
            }
        }
        ctx.ok(Map.of("saved", true));
    }

    private static void density(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("density.read");
        Map<String, Object> station = auth.station(required(ctx));
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        String where = "d.station_id = ?";
        List<Object> params = new ArrayList<>(List.of(station.get("id")));
        if (ctx.q("from") != null) { where += " AND d.business_date >= ?"; params.add(ctx.q("from")); }
        if (ctx.q("to") != null) { where += " AND d.business_date <= ?"; params.add(ctx.q("to")); }
        long total = Db.count("SELECT COUNT(*) AS count FROM density_checks d WHERE " + where, params.toArray());
        params.add(size);
        params.add((page - 1) * size);
        ctx.ok(Json.shapeAll(Db.all(
                """
                SELECT d.*, t.code AS tank_code, t.name AS tank_name, p.name AS product_name, p.color AS product_color, u.name AS checked_by_name
                  FROM density_checks d
                  JOIN tanks t ON t.id = d.tank_id
                  JOIN fuel_products p ON p.id = d.product_id
                  LEFT JOIN users u ON u.id = d.checked_by
                 WHERE %s ORDER BY d.business_date DESC, d.checked_at DESC LIMIT ? OFFSET ?
                """.formatted(where), params.toArray())), Domain.page(total, page, size));
    }

    private static void addDensity(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("density.write");
        Map<String, Object> tank = Db.one("SELECT * FROM tanks WHERE id = ?", requiredBody(ctx, "tankId"));
        if (tank == null) throw ApiException.notFound("Tank not found");
        auth.station(Db.str(tank, "station_id"));
        String id = Clock.newId("dns");
        Db.exec(
                """
                INSERT INTO density_checks
                  (id, tenant_id, station_id, tank_id, product_id, business_date, checked_at, observed_density, observed_temp_c, density_at_15c, spec_min, spec_max, within_spec, source, checked_by, note, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), tank.get("station_id"), tank.get("id"), tank.get("product_id"),
                ctx.str("businessDate") == null ? Clock.todayIst() : ctx.str("businessDate"), Clock.nowIso(),
                requiredBody(ctx, "observedDensity"), ctx.str("observedTempC") == null ? "15" : ctx.str("observedTempC"),
                ctx.str("densityAt15c") == null ? requiredBody(ctx, "observedDensity") : ctx.str("densityAt15c"),
                ctx.str("specMin"), ctx.str("specMax"), ctx.body().get("withinSpec") instanceof Boolean flag && !flag ? 0 : 1,
                ctx.str("source") == null ? "NOZZLE" : ctx.str("source"), auth.userId, ctx.str("note"), Clock.nowIso());
        ctx.created(Json.shape(Db.one("SELECT * FROM density_checks WHERE id = ?", id)));
    }

    private static void deleteDensity(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("density.write");
        Db.exec("DELETE FROM density_checks WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        ctx.ok(Map.of("deleted", true));
    }

    private static void compliance(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("compliance.read");
        Map<String, Object> station = auth.station(required(ctx));
        List<Map<String, Object>> documents = new ArrayList<>();
        int expired = 0, expiring = 0, ok = 0;
        LocalDate today = LocalDate.parse(Clock.todayIst());
        for (Map<String, Object> row : Db.all(
                """
                SELECT c.*, d.code AS dispenser_code, t.code AS tank_code
                  FROM compliance_documents c
                  LEFT JOIN dispensers d ON d.id = c.dispenser_id
                  LEFT JOIN tanks t ON t.id = c.tank_id
                 WHERE c.station_id = ? ORDER BY c.expires_on
                """, station.get("id"))) {
            Map<String, Object> doc = Json.shape(row);
            LocalDate expires = LocalDate.parse(Db.str(row, "expires_on").substring(0, 10));
            long days = ChronoUnit.DAYS.between(today, expires);
            int lead = (int) Db.num(row, "renewal_lead_days");
            String status = days < 0 ? "EXPIRED" : days <= lead ? "EXPIRING" : "OK";
            if ("EXPIRED".equals(status)) expired++;
            else if ("EXPIRING".equals(status)) expiring++;
            else ok++;
            doc.put("daysLeft", days);
            doc.put("status", status);
            documents.add(doc);
        }
        ctx.ok(Map.of("documents", documents, "summary", Map.of("expired", expired, "expiring", expiring, "ok", ok)));
    }

    private static void addCompliance(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("compliance.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        String id = Clock.newId("cmp");
        String now = Clock.nowIso();
        Db.exec(
                """
                INSERT INTO compliance_documents
                  (id, tenant_id, station_id, dispenser_id, tank_id, doc_type, title, doc_number, authority, issued_on, expires_on, renewal_lead_days, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), station.get("id"), emptyToNull(ctx.str("dispenserId")), emptyToNull(ctx.str("tankId")),
                requiredBody(ctx, "docType"), requiredBody(ctx, "title"), ctx.str("docNumber"), ctx.str("authority"),
                emptyToNull(ctx.str("issuedOn")), requiredBody(ctx, "expiresOn"),
                ctx.str("renewalLeadDays") == null ? 30 : Integer.parseInt(ctx.str("renewalLeadDays")), ctx.str("notes"), now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM compliance_documents WHERE id = ?", id)));
    }

    private static void patchCompliance(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("compliance.write");
        Db.exec("UPDATE compliance_documents SET title = COALESCE(?, title), expires_on = COALESCE(?, expires_on), notes = COALESCE(?, notes), updated_at = ? WHERE id = ? AND tenant_id = ?",
                ctx.str("title"), ctx.str("expiresOn"), ctx.str("notes"), Clock.nowIso(), ctx.p("id"), auth.tenantId());
        ctx.ok(Json.shape(Db.one("SELECT * FROM compliance_documents WHERE id = ?", ctx.p("id"))));
    }

    private static void deleteCompliance(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("compliance.write");
        Db.exec("DELETE FROM compliance_documents WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        ctx.ok(Map.of("deleted", true));
    }

    private static void lubricants(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("lubricants.read");
        if (ctx.q("stationId") != null) auth.station(ctx.q("stationId"));
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : Db.all("SELECT * FROM lube_products WHERE tenant_id = ? ORDER BY name", auth.tenantId())) {
            Map<String, Object> item = Json.shape(row);
            item.put("hsn", row.get("hsn_code"));
            item.put("stockQty", Money.litres(lubeStock(Db.str(row, "id"), ctx.q("stationId"))));
            out.add(item);
        }
        ctx.ok(out);
    }

    private static void addLubricant(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("lubricants.write");
        String id = Clock.newId("lub");
        String now = Clock.nowIso();
        Db.exec(
                "INSERT INTO lube_products (id, tenant_id, code, name, brand, pack_size, hsn_code, gst_rate_pct, purchase_rate, sale_rate, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
                id, auth.tenantId(), requiredBody(ctx, "code"), requiredBody(ctx, "name"), ctx.str("brand"),
                ctx.str("packSize") == null ? "1 L" : ctx.str("packSize"), ctx.str("hsn"),
                ctx.str("gstRatePct") == null ? "18" : ctx.str("gstRatePct"),
                Money.money(ctx.str("purchaseRate") == null ? "0" : ctx.str("purchaseRate")),
                Money.money(ctx.str("saleRate") == null ? "0" : ctx.str("saleRate")), now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM lube_products WHERE id = ?", id)));
    }

    private static void patchLubricant(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("lubricants.write");
        Db.exec("UPDATE lube_products SET name = COALESCE(?, name), sale_rate = COALESCE(?, sale_rate), is_active = COALESCE(?, is_active), updated_at = ? WHERE id = ? AND tenant_id = ?",
                ctx.str("name"), ctx.str("saleRate"), ctx.body().containsKey("isActive") ? (Boolean.TRUE.equals(ctx.body().get("isActive")) || "1".equals(ctx.str("isActive")) ? 1 : 0) : null,
                Clock.nowIso(), ctx.p("id"), auth.tenantId());
        ctx.ok(Json.shape(Db.one("SELECT * FROM lube_products WHERE id = ?", ctx.p("id"))));
    }

    private static void lubeMovements(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("lubricants.read");
        Map<String, Object> station = auth.station(required(ctx));
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        long total = Db.count("SELECT COUNT(*) AS count FROM lube_movements WHERE station_id = ?", station.get("id"));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> row : Db.all(
                """
                SELECT m.*, p.code AS product_code, p.name AS product_name, p.pack_size, c.name AS customer_name
                  FROM lube_movements m
                  JOIN lube_products p ON p.id = m.product_id
                  LEFT JOIN customers c ON c.id = m.customer_id
                 WHERE m.station_id = ? ORDER BY m.occurred_at DESC LIMIT ? OFFSET ?
                """, station.get("id"), size, (page - 1) * size)) {
            Map<String, Object> item = Json.shape(row);
            item.put("gstAmount", "0.00");
            rows.add(item);
        }
        ctx.ok(rows, Domain.page(total, page, size));
    }

    private static void addLubeMovement(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("lubricants.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        String id = Clock.newId("lbm");
        String qty = requiredBody(ctx, "quantity");
        if ("SALE".equals(ctx.str("type")) && !qty.startsWith("-")) qty = "-" + qty;
        Db.exec(
                """
                INSERT INTO lube_movements
                  (id, tenant_id, station_id, product_id, type, quantity, rate, amount, payment_mode, customer_id, vehicle_number, note, occurred_at, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), station.get("id"), requiredBody(ctx, "productId"), ctx.str("type") == null ? "SALE" : ctx.str("type"),
                qty, Money.money(ctx.str("rate") == null ? "0" : ctx.str("rate")), Money.money(ctx.str("amount") == null ? "0" : ctx.str("amount")),
                ctx.str("paymentMode"), emptyToNull(ctx.str("customerId")), ctx.str("vehicleNumber"), ctx.str("note"), Clock.nowIso(), auth.userId, Clock.nowIso());
        ctx.created(Map.of("id", id));
    }

    private static void devices(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("devices.read");
        Map<String, Object> station = auth.station(required(ctx));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> row : Db.all("SELECT * FROM hardware_devices WHERE station_id = ? ORDER BY code", station.get("id"))) {
            Map<String, Object> item = Json.shape(row);
            item.put("online", false);
            item.put("pendingEvents", 0);
            item.put("lastEventAt", null);
            rows.add(item);
        }
        ctx.ok(rows);
    }

    private static void deviceEvents(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("devices.read");
        Map<String, Object> device = Db.one("SELECT * FROM hardware_devices WHERE id = ?", ctx.p("id"));
        if (device == null || (auth.tenantId != null && !auth.tenantId.equals(Db.str(device, "tenant_id")))) throw ApiException.notFound("Device not found");
        auth.station(Db.str(device, "station_id"));
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        long total = Db.count("SELECT COUNT(*) AS count FROM device_events WHERE device_id = ?", device.get("id"));
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM device_events WHERE device_id = ? ORDER BY received_at DESC LIMIT ? OFFSET ?", device.get("id"), size, (page - 1) * size), List.of("payload")), Domain.page(total, page, size));
    }

    private static void addDevice(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("devices.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        String id = Clock.newId("dev");
        String key = Passwords.randomToken();
        String now = Clock.nowIso();
        Db.exec(
                """
                INSERT INTO hardware_devices
                  (id, tenant_id, station_id, code, name, type, vendor, model, serial_number, protocol, status, api_key_hash, api_key_prefix, key_version, is_simulated, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE', ?, ?, 1, 1, ?, ?, ?)
                """,
                id, auth.tenantId(), station.get("id"), requiredBody(ctx, "code"), requiredBody(ctx, "name"),
                ctx.str("type") == null ? "GATEWAY" : ctx.str("type"), ctx.str("vendor"), ctx.str("model"), ctx.str("serialNumber"), ctx.str("protocol"),
                Passwords.sha256(key), key.substring(0, 8), ctx.str("notes"), now, now);
        Map<String, Object> created = Json.shape(Db.one("SELECT * FROM hardware_devices WHERE id = ?", id));
        created.put("apiKey", key);
        created.put("warning", "Copy this key now. It is stored only as a hash.");
        created.put("online", false);
        ctx.created(created);
    }

    private static void patchDevice(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("devices.write");
        Db.exec("UPDATE hardware_devices SET status = COALESCE(?, status), updated_at = ? WHERE id = ? AND tenant_id = ?", ctx.str("status"), Clock.nowIso(), ctx.p("id"), auth.tenantId());
        Map<String, Object> row = Json.shape(Db.one("SELECT * FROM hardware_devices WHERE id = ?", ctx.p("id")));
        row.put("online", false);
        ctx.ok(row);
    }

    private static void rotateKey(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("devices.write");
        String key = Passwords.randomToken();
        Db.exec("UPDATE hardware_devices SET api_key_hash = ?, api_key_prefix = ?, key_version = key_version + 1, updated_at = ? WHERE id = ? AND tenant_id = ?",
                Passwords.sha256(key), key.substring(0, 8), Clock.nowIso(), ctx.p("id"), auth.tenantId());
        Map<String, Object> row = Db.one("SELECT key_version FROM hardware_devices WHERE id = ?", ctx.p("id"));
        ctx.ok(Map.of("apiKey", key, "keyVersion", row.get("key_version"), "warning", "Copy this key now. The previous key no longer works."));
    }

    private static void replay(Web.Ctx ctx) {
        ctx.requireAuth().require("devices.write");
        ctx.ok(Map.of("replayed", false, "note", "Replay is not available until a certified controller adapter is connected."));
    }

    private static void hardwareDiagnostics(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("devices.read");
        Map<String, Object> station = auth.station(required(ctx));
        List<Map<String, Object>> devices = new ArrayList<>();
        for (Map<String, Object> row : Db.all("SELECT id, name, status FROM hardware_devices WHERE station_id = ?", station.get("id"))) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", row.get("id"));
            item.put("name", row.get("name"));
            item.put("online", "ONLINE".equals(row.get("status")));
            devices.add(item);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("serverTime", Clock.nowIso());
        body.put("onlineWindowMinutes", 5);
        body.put("devices", devices);
        body.put("eventCounts", Map.of());
        body.put("qualityCounts", Map.of());
        body.put("lastEventAt", null);
        body.put("realHardwareVerified", false);
        body.put("disclaimer", "Simulated data only until tested against a compatible forecourt controller.");
        body.put("recentErrors", List.of());
        body.put("adapterContract", Map.of("version", "1", "inboundAuth", "X-Device-Key", "eventTypes", List.of("READING", "HEARTBEAT"), "idempotency", "eventId"));
        ctx.ok(body);
    }

    private static void readings(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("readings.read");
        Map<String, Object> station = auth.station(required(ctx));
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        String where = "station_id = ?";
        List<Object> params = new ArrayList<>(List.of(station.get("id")));
        if (ctx.q("nozzleId") != null) { where += " AND nozzle_id = ?"; params.add(ctx.q("nozzleId")); }
        if (ctx.q("quality") != null) { where += " AND quality = ?"; params.add(ctx.q("quality")); }
        if (ctx.q("source") != null) { where += " AND source = ?"; params.add(ctx.q("source")); }
        long total = Db.count("SELECT COUNT(*) AS count FROM meter_readings WHERE " + where, params.toArray());
        params.add(size);
        params.add((page - 1) * size);
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM meter_readings WHERE " + where + " ORDER BY reading_at DESC LIMIT ? OFFSET ?", params.toArray())), Domain.page(total, page, size));
    }

    private static void manualReading(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("readings.manual");
        Map<String, Object> nozzle = Db.one("SELECT * FROM nozzles WHERE id = ?", requiredBody(ctx, "nozzleId"));
        if (nozzle == null) throw ApiException.notFound("Nozzle not found");
        auth.station(Db.str(nozzle, "station_id"));
        String id = Clock.newId("rdg");
        Db.exec(
                """
                INSERT INTO meter_readings
                  (id, tenant_id, station_id, nozzle_id, reading_value, unit, quality, source, reading_at, sequence, is_countable, is_simulated, note, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, 'L', 'VALID', 'MANUAL', ?, 0, 1, 0, ?, ?, ?)
                """,
                id, auth.tenantId(), nozzle.get("station_id"), nozzle.get("id"), Money.rate(requiredBody(ctx, "readingValue")),
                Clock.nowIso(), ctx.str("note"), auth.userId, Clock.nowIso());
        Auth.audit(auth, "MANUAL_READING", "MeterReading", id, Db.str(nozzle, "station_id"), "Manual totalizer reading");
        ctx.created(Json.shape(Db.one("SELECT * FROM meter_readings WHERE id = ?", id)));
    }

    private static void simulate(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        if (!ctx.config.demoTools) throw ApiException.forbidden("Demo tools are disabled");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        int events = ctx.str("events") == null ? 2 : Integer.parseInt(ctx.str("events"));
        List<Map<String, Object>> generated = new ArrayList<>();
        List<Map<String, Object>> nozzles = Db.all("SELECT id FROM nozzles WHERE station_id = ? AND status = 'ACTIVE' LIMIT 4", station.get("id"));
        for (int i = 0; i < events && !nozzles.isEmpty(); i++) {
            Map<String, Object> nozzle = nozzles.get(i % nozzles.size());
            Map<String, Object> last = Db.one("SELECT reading_value FROM meter_readings WHERE nozzle_id = ? ORDER BY reading_at DESC LIMIT 1", nozzle.get("id"));
            String value = Money.rate(Money.d(last == null ? "0" : last.get("reading_value")).add(new BigDecimal("12.500")));
            String id = Clock.newId("rdg");
            Db.exec(
                    """
                    INSERT INTO meter_readings
                      (id, tenant_id, station_id, nozzle_id, reading_value, unit, quality, source, reading_at, sequence, is_countable, is_simulated, note, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, 'L', 'VALID', 'SIMULATED', ?, 0, 0, 1, 'Simulated preview reading', ?, ?)
                    """,
                    id, auth.tenantId(), station.get("id"), nozzle.get("id"), value, Clock.nowIso(), auth.userId, Clock.nowIso());
            generated.add(Map.of("eventId", id, "readingId", id));
        }
        ctx.ok(Map.of("simulated", true, "generated", generated));
    }

    private static void metrics(Web.Ctx ctx) {
        platform(ctx);
        Map<String, Object> tenants = new LinkedHashMap<>();
        tenants.put("total", Db.count("SELECT COUNT(*) AS count FROM tenants"));
        tenants.put("active", Db.count("SELECT COUNT(*) AS count FROM tenants WHERE status = 'ACTIVE'"));
        tenants.put("suspended", Db.count("SELECT COUNT(*) AS count FROM tenants WHERE status = 'SUSPENDED'"));
        tenants.put("pending", Db.count("SELECT COUNT(*) AS count FROM tenants WHERE status = 'PENDING'"));
        tenants.put("demo", Db.count("SELECT COUNT(*) AS count FROM tenants WHERE is_demo = 1"));
        List<Map<String, Object>> recent = new ArrayList<>();
        for (Map<String, Object> row : Db.all("SELECT id, name, slug, status, created_at FROM tenants ORDER BY created_at DESC LIMIT 6")) {
            Map<String, Object> item = Json.shape(row);
            item.put("stationCount", Db.count("SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?", row.get("id")));
            item.put("userCount", Db.count("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ?", row.get("id")));
            recent.add(item);
        }
        ctx.ok(Map.of(
                "tenants", tenants,
                "stations", Db.count("SELECT COUNT(*) AS count FROM stations"),
                "users", Db.count("SELECT COUNT(*) AS count FROM users"),
                "subscriptions", Map.of("trialing", 0, "active", Db.count("SELECT COUNT(*) AS count FROM subscriptions WHERE status = 'ACTIVE'"), "pastDue", 0, "suspended", 0, "cancelled", 0, "mrr", "0.00", "arr", "0.00", "byPlan", List.of(), "trialsEndingSoon", List.of(), "expiringSoon", List.of()),
                "devices", Map.of("total", Db.count("SELECT COUNT(*) AS count FROM hardware_devices"), "online", 0, "offline", Db.count("SELECT COUNT(*) AS count FROM hardware_devices"), "simulated", Db.count("SELECT COUNT(*) AS count FROM hardware_devices WHERE is_simulated = 1"), "disabled", 0, "realHardwareVerified", false, "events", Map.of()),
                "invoices", Map.of("outstanding", "0.00", "overdue", 0, "issued", Db.count("SELECT COUNT(*) AS count FROM subscription_invoices")),
                "errors", Map.of("open", Db.count("SELECT COUNT(*) AS count FROM platform_errors WHERE resolved_at IS NULL"), "recent", List.of()),
                "recentTenants", recent,
                "note", "Platform figures are live counts from MySQL.",
                "generatedAt", Clock.nowIso()));
    }

    private static void plans(Web.Ctx ctx) {
        platform(ctx);
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM subscription_plans ORDER BY monthly_price")));
    }

    private static void addPlan(Web.Ctx ctx) {
        platform(ctx);
        String id = Clock.newId("pln");
        String now = Clock.nowIso();
        Db.exec("INSERT INTO subscription_plans (id, code, name, monthly_price, annual_price, max_stations, max_users, max_dispensers, trial_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, requiredBody(ctx, "code"), requiredBody(ctx, "name"), Money.money(ctx.str("monthlyPrice") == null ? "0" : ctx.str("monthlyPrice")),
                Money.money(ctx.str("annualPrice") == null ? "0" : ctx.str("annualPrice")),
                ctx.str("maxStations") == null ? 1 : Integer.parseInt(ctx.str("maxStations")),
                ctx.str("maxUsers") == null ? 5 : Integer.parseInt(ctx.str("maxUsers")),
                ctx.str("maxDispensers") == null ? 4 : Integer.parseInt(ctx.str("maxDispensers")),
                ctx.str("trialDays") == null ? 14 : Integer.parseInt(ctx.str("trialDays")), now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM subscription_plans WHERE id = ?", id)));
    }

    private static void patchPlan(Web.Ctx ctx) {
        platform(ctx);
        if (ctx.body().containsKey("isActive")) {
            Db.exec("UPDATE subscription_plans SET is_active = ?, updated_at = ? WHERE id = ?", Boolean.TRUE.equals(ctx.body().get("isActive")) ? 1 : 0, Clock.nowIso(), ctx.p("id"));
        }
        ctx.ok(Json.shape(Db.one("SELECT * FROM subscription_plans WHERE id = ?", ctx.p("id"))));
    }

    private static void tenants(Web.Ctx ctx) {
        platform(ctx);
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        String where = "1 = 1";
        List<Object> params = new ArrayList<>();
        if (ctx.q("status") != null && !ctx.q("status").isBlank()) { where += " AND status = ?"; params.add(ctx.q("status")); }
        if (ctx.q("search") != null && !ctx.q("search").isBlank()) { where += " AND (name LIKE ? OR slug LIKE ?)"; params.add("%" + ctx.q("search") + "%"); params.add("%" + ctx.q("search") + "%"); }
        long total = Db.count("SELECT COUNT(*) AS count FROM tenants WHERE " + where, params.toArray());
        params.add(size);
        params.add((page - 1) * size);
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM tenants WHERE " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?", params.toArray())), Domain.page(total, page, size));
    }

    private static void addTenant(Web.Ctx ctx) {
        platform(ctx);
        String id = Clock.newId("tnt");
        String now = Clock.nowIso();
        Db.exec("INSERT INTO tenants (id, name, slug, status, is_demo, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', 0, ?, ?)",
                id, requiredBody(ctx, "name"), requiredBody(ctx, "slug"), now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM tenants WHERE id = ?", id)));
    }

    private static void tenant(Web.Ctx ctx) {
        platform(ctx);
        Map<String, Object> row = Db.one("SELECT * FROM tenants WHERE id = ?", ctx.p("id"));
        if (row == null) throw ApiException.notFound("Tenant not found");
        Map<String, Object> tenant = Json.shape(row);
        if (tenant.get("contactEmail") == null) tenant.put("contactEmail", "");
        Map<String, Object> subscription = Json.shape(Db.one(
                "SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.monthly_price, p.max_stations, p.max_users, p.max_dispensers FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1",
                ctx.p("id")));
        List<Map<String, Object>> devices = new ArrayList<>();
        for (Map<String, Object> device : Db.all("SELECT d.*, s.name AS station_name FROM hardware_devices d JOIN stations s ON s.id = d.station_id WHERE d.tenant_id = ?", ctx.p("id"))) {
            Map<String, Object> item = Json.shape(device);
            item.put("online", false);
            devices.add(item);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tenant", tenant);
        body.put("subscription", subscription);
        body.put("stations", Json.shapeAll(Db.all("SELECT * FROM stations WHERE tenant_id = ?", ctx.p("id"))));
        body.put("users", Json.shapeAll(Db.all("SELECT id, name, email, role_key, status, last_login_at FROM users WHERE tenant_id = ?", ctx.p("id"))));
        body.put("invoices", Json.shapeAll(Db.all("SELECT * FROM subscription_invoices WHERE tenant_id = ? ORDER BY issued_at DESC", ctx.p("id"))));
        body.put("devices", devices);
        body.put("auditTrail", Json.shapeAll(Db.all("SELECT id, action, summary, actor_email, created_at FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 30", ctx.p("id"))));
        body.put("usage", Map.of(
                "stations", Db.count("SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?", ctx.p("id")),
                "users", Db.count("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ?", ctx.p("id")),
                "dispensers", Db.count("SELECT COUNT(*) AS count FROM dispensers d JOIN stations s ON s.id = d.station_id WHERE s.tenant_id = ?", ctx.p("id")),
                "maxStations", subscription == null ? 0 : subscription.get("maxStations"),
                "maxUsers", subscription == null ? 0 : subscription.get("maxUsers"),
                "maxDispensers", subscription == null ? 0 : subscription.get("maxDispensers")));
        ctx.ok(body);
    }

    private static void patchTenant(Web.Ctx ctx) {
        platform(ctx);
        Db.exec("UPDATE tenants SET status = COALESCE(?, status), updated_at = ? WHERE id = ?", ctx.str("status"), Clock.nowIso(), ctx.p("id"));
        ctx.ok(Json.shape(Db.one("SELECT * FROM tenants WHERE id = ?", ctx.p("id"))));
    }

    private static void setSubscription(Web.Ctx ctx) {
        platform(ctx);
        String id = Clock.newId("sub");
        String now = Clock.nowIso();
        Db.exec("INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)",
                id, ctx.p("id"), requiredBody(ctx, "planId"), now, now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM subscriptions WHERE id = ?", id)));
    }

    private static void addInvoice(Web.Ctx ctx) {
        platform(ctx);
        Map<String, Object> sub = Db.one("SELECT id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1", ctx.p("id"));
        if (sub == null) throw ApiException.unprocessable("Create a subscription before invoicing");
        String id = Clock.newId("inv");
        Db.exec(
                "INSERT INTO subscription_invoices (id, tenant_id, subscription_id, invoice_number, period_start, period_end, amount, total_amount, status, issued_at, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?)",
                id, ctx.p("id"), sub.get("id"), "INV-" + id.substring(4, 12), Clock.todayIst(), Clock.todayIst(),
                Money.money(requiredBody(ctx, "amount")), Money.money(requiredBody(ctx, "amount")), Clock.nowIso(), Clock.todayIst(), Clock.nowIso());
        ctx.created(Json.shape(Db.one("SELECT * FROM subscription_invoices WHERE id = ?", id)));
    }

    private static void subscriptions(Web.Ctx ctx) {
        platform(ctx);
        ctx.ok(Json.shapeAll(Db.all("SELECT s.*, t.name AS tenant_name, p.name AS plan_name, p.code AS plan_code FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN subscription_plans p ON p.id = s.plan_id ORDER BY s.created_at DESC")));
    }

    private static void invoices(Web.Ctx ctx) {
        platform(ctx);
        ctx.ok(Json.shapeAll(Db.all("SELECT i.*, t.name AS tenant_name FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id ORDER BY i.issued_at DESC")));
    }

    private static void markPaid(Web.Ctx ctx) {
        platform(ctx);
        Db.exec("UPDATE subscription_invoices SET status = 'PAID', paid_at = ?, payment_reference = ?, payment_method = ? WHERE id = ?",
                Clock.nowIso(), ctx.str("paymentReference"), ctx.str("paymentMethod"), ctx.p("id"));
        ctx.ok(Json.shape(Db.one("SELECT * FROM subscription_invoices WHERE id = ?", ctx.p("id"))));
    }

    private static void adminStations(Web.Ctx ctx) {
        platform(ctx);
        if (ctx.q("tenantId") != null && !ctx.q("tenantId").isBlank()) {
            ctx.ok(Json.shapeAll(Db.all("SELECT * FROM stations WHERE tenant_id = ? ORDER BY name", ctx.q("tenantId"))));
        } else {
            ctx.ok(Json.shapeAll(Db.all("SELECT * FROM stations ORDER BY name")));
        }
    }

    private static void addStation(Web.Ctx ctx) {
        platform(ctx);
        String id = Clock.newId("stn");
        String now = Clock.nowIso();
        Db.exec("INSERT INTO stations (id, tenant_id, code, name, address, city, state, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)",
                id, requiredBody(ctx, "tenantId"), requiredBody(ctx, "code"), requiredBody(ctx, "name"), ctx.str("address"), ctx.str("city"), ctx.str("state"), now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM stations WHERE id = ?", id)));
    }

    private static void patchStation(Web.Ctx ctx) {
        platform(ctx);
        Db.exec("UPDATE stations SET status = COALESCE(?, status), updated_at = ? WHERE id = ?", ctx.str("status"), Clock.nowIso(), ctx.p("id"));
        ctx.ok(Json.shape(Db.one("SELECT * FROM stations WHERE id = ?", ctx.p("id"))));
    }

    private static void adminDevices(Web.Ctx ctx) {
        platform(ctx);
        List<Map<String, Object>> devices = new ArrayList<>();
        for (Map<String, Object> row : Db.all(
                "SELECT d.*, s.name AS station_name, t.name AS tenant_name FROM hardware_devices d JOIN stations s ON s.id = d.station_id JOIN tenants t ON t.id = d.tenant_id ORDER BY d.code")) {
            Map<String, Object> item = Json.shape(row);
            item.put("online", false);
            item.put("eventCount", 0);
            item.put("errorCount", 0);
            devices.add(item);
        }
        ctx.ok(Map.of("devices", devices, "onlineWindowMinutes", 5, "realHardwareVerified", false, "note", "Simulated until a certified controller is connected."));
    }

    private static void errors(Web.Ctx ctx) {
        platform(ctx);
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        String where = "true".equals(ctx.q("resolved")) ? "1 = 1" : "resolved_at IS NULL";
        long total = Db.count("SELECT COUNT(*) AS count FROM platform_errors WHERE " + where);
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM platform_errors WHERE " + where + " ORDER BY created_at DESC LIMIT ? OFFSET ?", size, (page - 1) * size)), Domain.page(total, page, size));
    }

    private static void resolveError(Web.Ctx ctx) {
        platform(ctx);
        Db.exec("UPDATE platform_errors SET resolved_at = ? WHERE id = ?", Clock.nowIso(), ctx.p("id"));
        ctx.ok(Map.of("resolved", true));
    }

    private static void platform(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        if (!auth.superAdmin && !auth.can("platform.manage")) throw ApiException.forbidden();
    }

    private static BigDecimal lubeStock(String productId, String stationId) {
        BigDecimal total = BigDecimal.ZERO;
        List<Map<String, Object>> rows = stationId == null
                ? Db.all("SELECT quantity FROM lube_movements WHERE product_id = ?", productId)
                : Db.all("SELECT quantity FROM lube_movements WHERE product_id = ? AND station_id = ?", productId, stationId);
        for (Map<String, Object> row : rows) total = total.add(Money.d(row.get("quantity")));
        return total;
    }

    private static double countStatus(String userId, String month, String status) {
        return Db.count("SELECT COUNT(*) AS count FROM attendance_records WHERE user_id = ? AND attendance_date LIKE ? AND status = ?", userId, month + "%", status);
    }

    private static Map<String, String> defaults() {
        Map<String, String> defaults = new LinkedHashMap<>();
        defaults.put("hardware.maxJumpLitres", "10000");
        defaults.put("hardware.heartbeatTimeoutMinutes", "5");
        defaults.put("hardware.allowManualFallback", "true");
        defaults.put("shifts.unclosedAlertHours", "14");
        defaults.put("shifts.varianceToleranceLitres", "1");
        defaults.put("notifications.contactEmail", "");
        defaults.put("notifications.unclosedShiftAlerts", "true");
        return defaults;
    }

    private static Map<String, Map<String, Object>> schema() {
        Map<String, Map<String, Object>> schema = new LinkedHashMap<>();
        schema.put("hardware.maxJumpLitres", field("number", "Maximum believable jump (litres)", "A totalizer increase larger than this is flagged.", "station"));
        schema.put("hardware.heartbeatTimeoutMinutes", field("number", "Heartbeat timeout (minutes)", "A gateway with no heartbeat in this window is offline.", "station"));
        schema.put("hardware.allowManualFallback", field("boolean", "Allow manual reading fallback", "Authorised staff may capture a missing totalizer reading.", "station"));
        schema.put("shifts.unclosedAlertHours", field("number", "Unclosed shift alert (hours)", "Open shifts older than this appear in alerts.", "tenant"));
        schema.put("shifts.varianceToleranceLitres", field("number", "Shift variance tolerance (litres)", "Larger differences flag the shift for approval.", "station"));
        schema.put("notifications.contactEmail", field("string", "Operations contact email", "Destination for the alert digest. Email delivery is not configured.", "tenant"));
        schema.put("notifications.unclosedShiftAlerts", field("boolean", "Unclosed shift alerts", "Show unclosed-shift warnings on dashboards.", "tenant"));
        return schema;
    }

    private static Map<String, Object> field(String type, String label, String description, String scope) {
        Map<String, Object> field = new LinkedHashMap<>();
        field.put("type", type);
        field.put("label", label);
        field.put("description", description);
        field.put("scope", scope);
        return field;
    }

    private static Object coerce(String key, String value) {
        if (key.endsWith("Fallback") || key.endsWith("Alerts")) return "true".equals(value);
        if (key.contains("Email")) return value;
        try { return Double.valueOf(value); } catch (NumberFormatException ignored) { return value; }
    }

    private static String required(Web.Ctx ctx) {
        String value = ctx.q("stationId");
        if (value == null || value.isBlank()) throw ApiException.unprocessable("stationId is required");
        return value;
    }

    private static String requiredBody(Web.Ctx ctx, String key) {
        String value = ctx.str(key);
        if (value == null || value.isBlank()) throw ApiException.validation(key, key + " is required");
        return value;
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
