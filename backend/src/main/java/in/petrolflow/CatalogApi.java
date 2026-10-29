package in.petrolflow;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class CatalogApi {
    private CatalogApi() {}

    public static void register(Web web) {
        web.get("/catalog/stations", CatalogApi::stations);
        web.post("/catalog/stations", CatalogApi::createStation);
        web.patch("/catalog/stations/:id", CatalogApi::patchStation);
        web.get("/catalog/products", ctx -> crudList(ctx, "fuel_products", "products.read", true, false, "code", "name"));
        web.post("/catalog/products", ctx -> crudCreate(ctx, "fuel_products", "prd", "products.write", true, false, "code", "name", "category", "unit", "color", "isActive"));
        web.patch("/catalog/products/:id", ctx -> crudPatch(ctx, "fuel_products", "products.write", true, "name", "category", "unit", "color", "isActive"));
        web.get("/catalog/prices", CatalogApi::prices);
        web.post("/catalog/prices", CatalogApi::createPrice);
        web.get("/catalog/tanks", ctx -> crudList(ctx, "tanks", "tanks.read", false, true, "code", "name"));
        web.post("/catalog/tanks", ctx -> crudCreate(ctx, "tanks", "tnk", "tanks.write", false, true, "code", "name", "productId", "capacityLitres", "deadStockLitres", "status"));
        web.patch("/catalog/tanks/:id", ctx -> crudPatch(ctx, "tanks", "tanks.write", false, "name", "productId", "capacityLitres", "deadStockLitres", "status"));
        web.post("/catalog/tanks/:id/measurements", CatalogApi::measurement);
        web.get("/catalog/dispensers", ctx -> crudList(ctx, "dispensers", "dispensers.read", false, true, "code", "name"));
        web.post("/catalog/dispensers", ctx -> crudCreate(ctx, "dispensers", "dsp", "dispensers.write", false, true, "code", "name", "serialNumber", "model", "status"));
        web.patch("/catalog/dispensers/:id", ctx -> crudPatch(ctx, "dispensers", "dispensers.write", false, "name", "status"));
        web.get("/catalog/nozzles", ctx -> crudList(ctx, "nozzles", "dispensers.read", false, true, "label", "number"));
        web.post("/catalog/nozzles", ctx -> crudCreate(ctx, "nozzles", "nzl", "dispensers.write", false, true, "dispenserId", "number", "label", "productId", "tankId", "status"));
        web.patch("/catalog/nozzles/:id", ctx -> crudPatch(ctx, "nozzles", "dispensers.write", false, "label", "productId", "tankId", "status"));
        web.get("/catalog/nozzles/:id/history", CatalogApi::nozzleHistory);
        web.get("/catalog/customers", ctx -> crudList(ctx, "customers", "customers.read", true, false, "code", "name", "phone"));
        web.post("/catalog/customers", ctx -> crudCreate(ctx, "customers", "cus", "customers.write", true, false, "code", "name", "phone", "creditLimit", "creditDays", "status"));
        web.patch("/catalog/customers/:id", ctx -> crudPatch(ctx, "customers", "customers.write", true, "name", "phone", "creditLimit", "creditDays", "status"));
        web.get("/catalog/customers/:id/vehicles", CatalogApi::vehicles);
        web.post("/catalog/customers/:id/vehicles", CatalogApi::addVehicle);
        web.delete("/catalog/customers/:id/vehicles/:vehicleId", CatalogApi::deleteVehicle);
        web.get("/catalog/suppliers", ctx -> crudList(ctx, "suppliers", "suppliers.read", true, false, "code", "name"));
        web.post("/catalog/suppliers", ctx -> crudCreate(ctx, "suppliers", "sup", "suppliers.write", true, false, "code", "name", "phone", "gstin", "status"));
        web.patch("/catalog/suppliers/:id", ctx -> crudPatch(ctx, "suppliers", "suppliers.write", true, "name", "phone", "gstin", "isActive"));
        web.get("/catalog/expense-categories", ctx -> crudList(ctx, "expense_categories", "expenses.read", true, false, "name"));
        web.get("/catalog/employees", CatalogApi::employees);
        web.post("/catalog/employees", CatalogApi::createEmployee);
        web.patch("/catalog/employees/:id", CatalogApi::patchEmployee);
        web.post("/catalog/employees/:id/reset-password", CatalogApi::resetPassword);
        web.delete("/catalog/employees/:id", CatalogApi::disableEmployee);
        web.get("/catalog/followups", CatalogApi::dueFollowups);
        web.get("/catalog/customers/:id/followups", CatalogApi::followups);
        web.post("/catalog/customers/:id/followups", CatalogApi::addFollowup);
        web.get("/customers", ctx -> crudList(ctx, "customers", "customers.read", true, false, "code", "name"));
    }

    private static void stations(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stations.read");
        List<Map<String, Object>> rows = Db.all(
                """
                SELECT s.*,
                       (SELECT COUNT(*) FROM tanks t WHERE t.station_id = s.id) AS tank_count,
                       (SELECT COUNT(*) FROM dispensers d WHERE d.station_id = s.id) AS dispenser_count,
                       (SELECT COUNT(*) FROM nozzles n WHERE n.station_id = s.id) AS nozzle_count,
                       (SELECT COUNT(*) FROM hardware_devices h WHERE h.station_id = s.id) AS device_count
                  FROM stations s WHERE s.tenant_id = ? ORDER BY s.name
                """, auth.tenantId());
        List<Map<String, Object>> visible = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            if (auth.allStations || auth.stationIds.contains(Db.str(row, "id"))) visible.add(Json.shape(row));
        }
        ctx.ok(visible);
    }

    private static void createStation(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stations.write");
        String code = required(ctx, "code");
        String name = required(ctx, "name");
        long count = Db.count("SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?", auth.tenantId());
        Map<String, Object> limit = Db.one(
                """
                SELECT p.max_stations FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
                 WHERE s.tenant_id = ? AND s.status IN ('ACTIVE','TRIALING') ORDER BY s.created_at DESC LIMIT 1
                """, auth.tenantId());
        if (limit != null && count >= Db.num(limit, "max_stations")) {
            throw ApiException.unprocessable("Your plan allows " + limit.get("max_stations") + " station(s). Upgrade to add more.");
        }
        if (Db.one("SELECT id FROM stations WHERE tenant_id = ? AND code = ?", auth.tenantId(), code) != null) {
            throw ApiException.conflict("A station with this code already exists");
        }
        String id = Clock.newId("stn");
        String now = Clock.nowIso();
        Db.exec(
                """
                INSERT INTO stations (id, tenant_id, code, name, address, city, state, pincode, timezone, status, is_demo, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Kolkata', 'ACTIVE', 0, ?, ?)
                """,
                id, auth.tenantId(), code, name, ctx.str("address"), ctx.str("city"), ctx.str("state"), ctx.str("pincode"), now, now);
        Auth.audit(auth, "STATION_CREATED", "Station", id, id, name + " (" + code + ")");
        ctx.created(Json.shape(Db.one("SELECT * FROM stations WHERE id = ?", id)));
    }

    private static void patchStation(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stations.write");
        Map<String, Object> station = auth.station(ctx.p("id"));
        List<String> sets = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        for (String key : List.of("name", "address", "city", "state", "pincode", "status")) {
            if (ctx.body().containsKey(key)) {
                sets.add(key + " = ?");
                params.add(ctx.str(key));
            }
        }
        if (!sets.isEmpty()) {
            params.add(Clock.nowIso());
            params.add(station.get("id"));
            Db.exec("UPDATE stations SET " + String.join(", ", sets) + ", updated_at = ? WHERE id = ?", params.toArray());
        }
        ctx.ok(Json.shape(Db.one("SELECT * FROM stations WHERE id = ?", station.get("id"))));
    }

    private static void prices(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("products.read");
        String stationId = ctx.q("stationId");
        if (stationId != null) auth.station(stationId);
        List<Map<String, Object>> rows = Db.all(
                """
                SELECT fp.*, p.name AS product_name, p.code AS product_code, s.name AS station_name
                  FROM fuel_prices fp
                  JOIN fuel_products p ON p.id = fp.product_id
                  LEFT JOIN stations s ON s.id = fp.station_id
                 WHERE fp.tenant_id = ?
                 ORDER BY fp.effective_from DESC LIMIT 200
                """, auth.tenantId());
        List<Map<String, Object>> visible = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String id = Db.str(row, "station_id");
            if (id != null && !auth.allStations && !auth.stationIds.contains(id)) continue;
            if (stationId != null && id != null && !stationId.equals(id)) continue;
            visible.add(Json.shape(row));
        }
        ctx.ok(visible);
    }

    private static void createPrice(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("prices.write");
        String productId = required(ctx, "productId");
        String rate = required(ctx, "rate");
        String stationId = ctx.str("stationId");
        if (stationId != null) auth.station(stationId);
        String id = Clock.newId("prc");
        String now = Clock.nowIso();
        String from = ctx.str("effectiveFrom") == null ? now : ctx.str("effectiveFrom");
        Db.exec(
                """
                INSERT INTO fuel_prices (id, tenant_id, station_id, product_id, rate_per_litre, effective_from, note, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), stationId, productId, Money.rate(rate), from, ctx.str("note"), auth.userId, now);
        Auth.audit(auth, "PRICE_CHANGED", "FuelPrice", id, stationId, "Price " + Money.rate(rate));
        ctx.created(Json.shape(Db.one("SELECT * FROM fuel_prices WHERE id = ?", id)));
    }

    private static void measurement(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.write");
        Map<String, Object> tank = Db.one("SELECT * FROM tanks WHERE id = ?", ctx.p("id"));
        if (tank == null) throw ApiException.notFound("Tank not found");
        auth.station(Db.str(tank, "station_id"));
        String litres = ctx.str("measuredLitres");
        if (litres == null) throw ApiException.validation("measuredLitres", "Measured litres are required");
        var book = Domain.bookStock(Db.str(tank, "id"));
        String id = Clock.newId("tms");
        Db.exec(
                """
                INSERT INTO tank_measurements
                  (id, tenant_id, station_id, tank_id, method, measured_litres, book_stock_litres, variance_litres, measured_at, note, entered_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), tank.get("station_id"), tank.get("id"),
                ctx.str("method") == null ? "DIP" : ctx.str("method"),
                Money.litres(litres), Money.litres(book), Money.litres(Money.d(litres).subtract(book)),
                Clock.nowIso(), ctx.str("note"), auth.userId, Clock.nowIso());
        ctx.created(Json.shape(Db.one("SELECT * FROM tank_measurements WHERE id = ?", id)));
    }

    private static void nozzleHistory(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("readings.read");
        Map<String, Object> nozzle = Db.one("SELECT * FROM nozzles WHERE id = ?", ctx.p("id"));
        if (nozzle == null) throw ApiException.notFound("Nozzle not found");
        auth.station(Db.str(nozzle, "station_id"));
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM meter_readings WHERE nozzle_id = ? ORDER BY reading_at DESC LIMIT 50", nozzle.get("id"))));
    }

    private static void vehicles(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.read");
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM customer_vehicles WHERE customer_id = ? AND tenant_id = ? ORDER BY vehicle_number", ctx.p("id"), auth.tenantId())));
    }

    private static void addVehicle(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.write");
        String id = Clock.newId("veh");
        String now = Clock.nowIso();
        Db.exec(
                "INSERT INTO customer_vehicles (id, tenant_id, customer_id, vehicle_number, vehicle_type, driver_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                id, auth.tenantId(), ctx.p("id"), ctx.str("vehicleNumber"), ctx.str("vehicleType"), ctx.str("driverName"), now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM customer_vehicles WHERE id = ?", id)));
    }

    private static void deleteVehicle(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.write");
        Db.exec("DELETE FROM customer_vehicles WHERE id = ? AND customer_id = ? AND tenant_id = ?", ctx.p("vehicleId"), ctx.p("id"), auth.tenantId());
        ctx.ok(Map.of("deleted", true));
    }

    private static void employees(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("employees.read");
        List<Map<String, Object>> rows = Db.all(
                """
                SELECT id, name, email, phone, role_key, status, last_login_at, created_at, is_demo, granted_permissions
                  FROM users WHERE tenant_id = ? AND role_key IN ('OWNER','MANAGER','STAFF') ORDER BY name
                """, auth.tenantId());
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            if (!auth.allStations && "OWNER".equals(row.get("role_key"))) continue;
            Map<String, Object> shaped = Json.shape(row);
            List<String> stations = new ArrayList<>();
            for (Map<String, Object> access : Db.all("SELECT station_id FROM user_station_access WHERE user_id = ?", row.get("id"))) {
                String stationId = Db.str(access, "station_id");
                if (auth.allStations || auth.stationIds.contains(stationId)) stations.add(stationId);
            }
            shaped.put("stationIds", stations);
            shaped.put("permissions", "STAFF".equals(row.get("role_key")) ? Permissions.sanitize(row.get("granted_permissions")) : Permissions.forRole(Db.str(row, "role_key")));
            out.add(shaped);
        }
        ctx.ok(out);
    }

    private static void createEmployee(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("employees.write");
        String role = ctx.str("roleKey") == null ? "STAFF" : ctx.str("roleKey");
        if ("OWNER".equals(role)) throw ApiException.conflict("This organization already has one owner. The owner account cannot be duplicated.");
        if ("MANAGER".equals(role) && Db.one("SELECT id FROM users WHERE tenant_id = ? AND role_key = 'MANAGER' AND status = 'ACTIVE'", auth.tenantId()) != null) {
            throw ApiException.conflict("Only one manager is allowed. Add a staff login if you need another person with chosen permissions.");
        }
        long cap = Db.count(
                """
                SELECT p.max_users FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
                 WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1
                """, auth.tenantId());
        if (cap == 0) cap = 15;
        if (Db.count("SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND status = 'ACTIVE'", auth.tenantId()) >= cap) {
            throw ApiException.conflict("This plan allows " + cap + " team logins. Disable an unused account or ask the platform administrator to raise the limit.");
        }
        String password = required(ctx, "password");
        Passwords.assertStrength(password);
        String email = required(ctx, "email").toLowerCase().trim();
        if (Db.one("SELECT id FROM users WHERE email = ?", email) != null) throw ApiException.conflict("A user with this email already exists");
        List<String> stationIds = stringList(ctx.body().get("stationIds"));
        if (stationIds.isEmpty()) throw ApiException.unprocessable("Assign this login to at least one pump");
        for (String stationId : stationIds) auth.station(stationId);
        List<String> grants = "STAFF".equals(role) ? Permissions.sanitize(ctx.body().get("permissions")) : List.of();
        if ("STAFF".equals(role) && grants.isEmpty()) throw ApiException.unprocessable("Tick at least one permission. A staff login with no access cannot sign in to any screen.");
        String id = Clock.newId("usr");
        String now = Clock.nowIso();
        Db.tx(() -> {
            Db.exec(
                    """
                    INSERT INTO users (id, tenant_id, email, name, phone, password_hash, role_key, status, is_demo, granted_permissions, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?, ?)
                    """,
                    id, auth.tenantId(), email, required(ctx, "name"), ctx.str("phone"), Passwords.hash(password), role, Json.stringify(grants), now, now);
            for (String stationId : stationIds) {
                Db.exec("INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, '[]', ?)", Clock.newId("usa"), id, stationId, now);
            }
            return id;
        });
        Auth.audit(auth, "EMPLOYEE_CREATED", "User", id, null, required(ctx, "name") + " (" + role + ")");
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("id", id);
        data.put("name", ctx.str("name"));
        data.put("email", email);
        data.put("roleKey", role);
        data.put("stationIds", stationIds);
        data.put("permissions", grants);
        ctx.created(data);
    }

    private static void patchEmployee(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("employees.write");
        Map<String, Object> existing = Db.one("SELECT * FROM users WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        if (existing == null) throw ApiException.notFound("Employee not found");
        if ("OWNER".equals(existing.get("role_key")) && "DISABLED".equals(ctx.str("status"))) {
            throw ApiException.unprocessable("The owner account must remain active. You can update its name and phone.");
        }
        List<String> grants = "STAFF".equals(existing.get("role_key")) ? Permissions.sanitize(ctx.body().containsKey("permissions") ? ctx.body().get("permissions") : existing.get("granted_permissions")) : List.of();
        if ("STAFF".equals(existing.get("role_key")) && grants.isEmpty()) throw ApiException.unprocessable("A staff login needs at least one permission.");
        Db.tx(() -> {
            if (ctx.body().containsKey("name") || ctx.body().containsKey("phone") || ctx.body().containsKey("status") || ctx.body().containsKey("permissions")) {
                Db.exec(
                        "UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), status = COALESCE(?, status), granted_permissions = ?, updated_at = ? WHERE id = ?",
                        ctx.str("name"), ctx.str("phone"), ctx.str("status"), Json.stringify(grants), Clock.nowIso(), existing.get("id"));
            }
            if (ctx.body().containsKey("stationIds") && !"OWNER".equals(existing.get("role_key"))) {
                Db.exec("DELETE FROM user_station_access WHERE user_id = ?", existing.get("id"));
                for (String stationId : stringList(ctx.body().get("stationIds"))) {
                    auth.station(stationId);
                    Db.exec("INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, '[]', ?)", Clock.newId("usa"), existing.get("id"), stationId, Clock.nowIso());
                }
            }
            if ("DISABLED".equals(ctx.str("status")) || ("STAFF".equals(existing.get("role_key")) && ctx.body().containsKey("permissions"))) {
                Db.exec("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", Clock.nowIso(), existing.get("id"));
            }
            return null;
        });
        Auth.audit(auth, "EMPLOYEE_UPDATED", "User", Db.str(existing, "id"), null, "Employee updated");
        ctx.ok(Map.of("id", existing.get("id"), "roleKey", existing.get("role_key"), "permissions", "STAFF".equals(existing.get("role_key")) ? grants : Permissions.forRole(Db.str(existing, "role_key"))));
    }

    private static void resetPassword(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("employees.write");
        String password = required(ctx, "newPassword");
        Passwords.assertStrength(password);
        Db.exec("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ? AND tenant_id = ?", Passwords.hash(password), Clock.nowIso(), ctx.p("id"), auth.tenantId());
        Db.exec("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", Clock.nowIso(), ctx.p("id"));
        ctx.ok(Map.of("reset", true));
    }

    private static void disableEmployee(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("employees.write");
        if (ctx.p("id").equals(auth.userId)) throw ApiException.unprocessable("You cannot disable your own account");
        Map<String, Object> existing = Db.one("SELECT * FROM users WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        if (existing == null) throw ApiException.notFound("Employee not found");
        if ("OWNER".equals(existing.get("role_key"))) throw ApiException.unprocessable("The owner account cannot be disabled.");
        Db.exec("UPDATE users SET status = 'DISABLED', updated_at = ? WHERE id = ?", Clock.nowIso(), existing.get("id"));
        Db.exec("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", Clock.nowIso(), existing.get("id"));
        ctx.ok(Map.of("disabled", true));
    }

    private static void dueFollowups(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.read");
        String due = ctx.q("dueBy") == null ? Clock.todayIst() : ctx.q("dueBy");
        ctx.ok(Json.shapeAll(Db.all(
                """
                SELECT f.*, c.name AS customer_name, c.code AS customer_code, c.balance
                  FROM customer_followups f JOIN customers c ON c.id = f.customer_id
                 WHERE f.tenant_id = ? AND f.next_on IS NOT NULL AND f.next_on <= ?
                 ORDER BY f.next_on ASC LIMIT 30
                """, auth.tenantId(), due)));
    }

    private static void followups(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.read");
        ctx.ok(Json.shapeAll(Db.all(
                """
                SELECT f.*, u.name AS created_by_name FROM customer_followups f
                  LEFT JOIN users u ON u.id = f.created_by
                 WHERE f.customer_id = ? AND f.tenant_id = ? ORDER BY f.created_at DESC LIMIT 40
                """, ctx.p("id"), auth.tenantId())));
    }

    private static void addFollowup(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.write");
        if (Db.one("SELECT id FROM customers WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId()) == null) {
            throw ApiException.notFound("Customer not found");
        }
        String kind = required(ctx, "kind");
        String note = required(ctx, "note");
        String id = Clock.newId("cfu");
        Db.exec(
                """
                INSERT INTO customer_followups (id, tenant_id, customer_id, station_id, kind, note, promised_amount, next_on, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), ctx.p("id"), ctx.str("stationId"), kind, note.trim(), ctx.str("promisedAmount"), ctx.str("nextOn"), auth.userId, Clock.nowIso());
        Auth.audit(auth, "CUSTOMER_FOLLOWUP", "Customer", ctx.p("id"), ctx.str("stationId"), kind);
        ctx.created(Map.of("id", id));
    }

    private static void crudList(Web.Ctx ctx, String table, String permission, boolean tenant, boolean station, String... search) {
        Auth auth = ctx.requireAuth();
        auth.require(permission);
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        List<String> clauses = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        if (tenant) {
            clauses.add("tenant_id = ?");
            params.add(auth.tenantId());
        }
        if (station) {
            String stationId = ctx.q("stationId");
            if (stationId != null) {
                auth.station(stationId);
                clauses.add("station_id = ?");
                params.add(stationId);
            } else if (!auth.allStations) {
                clauses.add("station_id IN (" + placeholders(auth.stationIds.size()) + ")");
                params.addAll(auth.stationIds);
            } else {
                clauses.add("station_id IN (SELECT id FROM stations WHERE tenant_id = ?)");
                params.add(auth.tenantId());
            }
        }
        String q = ctx.q("search");
        if (q != null && !q.isBlank() && search.length > 0) {
            List<String> likes = new ArrayList<>();
            for (String column : search) {
                likes.add(column + " LIKE ?");
                params.add("%" + q.trim() + "%");
            }
            clauses.add("(" + String.join(" OR ", likes) + ")");
        }
        String where = clauses.isEmpty() ? "" : "WHERE " + String.join(" AND ", clauses);
        long total = Db.count("SELECT COUNT(*) AS count FROM " + table + " " + where, params.toArray());
        params.add(size);
        params.add((page - 1) * size);
        String order = "expense_categories".equals(table) ? "name" : "id";
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM " + table + " " + where + " ORDER BY " + order + " DESC LIMIT ? OFFSET ?", params.toArray())), Domain.page(total, page, size));
    }

    private static void crudCreate(Web.Ctx ctx, String table, String prefix, String permission, boolean tenant, boolean station, String... fields) {
        Auth auth = ctx.requireAuth();
        auth.require(permission);
        String id = Clock.newId(prefix);
        List<String> columns = new ArrayList<>(List.of("id"));
        List<String> marks = new ArrayList<>(List.of("?"));
        List<Object> values = new ArrayList<>(List.of(id));
        if (station) {
            Map<String, Object> st = auth.station(required(ctx, "stationId"));
            columns.add("station_id");
            marks.add("?");
            values.add(st.get("id"));
            if (tenant) {
                columns.add("tenant_id");
                marks.add("?");
                values.add(st.get("tenant_id"));
            }
        } else if (tenant) {
            columns.add("tenant_id");
            marks.add("?");
            values.add(auth.tenantId());
        }
        for (String field : fields) {
            if ("stationId".equals(field) || !ctx.body().containsKey(field)) continue;
            columns.add(snake(field));
            marks.add("?");
            values.add(valueOf(field, ctx.body().get(field)));
        }
        if ("dispensers".equals(table) && !columns.contains("serial_number")) {
            columns.add("serial_number");
            marks.add("?");
            values.add("SN-" + id.substring(4, 12));
        }
        String now = Clock.nowIso();
        if (!"expense_categories".equals(table)) {
            columns.add("created_at");
            marks.add("?");
            values.add(now);
            columns.add("updated_at");
            marks.add("?");
            values.add(now);
        }
        Db.exec("INSERT INTO " + table + " (" + String.join(", ", columns) + ") VALUES (" + String.join(", ", marks) + ")", values.toArray());
        ctx.created(Json.shape(Db.one("SELECT * FROM " + table + " WHERE id = ?", id)));
    }

    private static void crudPatch(Web.Ctx ctx, String table, String permission, boolean tenant, String... fields) {
        Auth auth = ctx.requireAuth();
        auth.require(permission);
        Map<String, Object> existing = Db.one("SELECT * FROM " + table + " WHERE id = ?", ctx.p("id"));
        if (existing == null) throw ApiException.notFound("Record not found");
        if (tenant && !auth.tenantId().equals(Db.str(existing, "tenant_id"))) throw ApiException.notFound("Record not found");
        if (existing.get("station_id") != null) auth.station(Db.str(existing, "station_id"));
        List<String> sets = new ArrayList<>();
        List<Object> params = new ArrayList<>();
        for (String field : fields) {
            if (!ctx.body().containsKey(field)) continue;
            sets.add(snake(field) + " = ?");
            params.add(valueOf(field, ctx.body().get(field)));
        }
        if (!sets.isEmpty()) {
            sets.add("updated_at = ?");
            params.add(Clock.nowIso());
            params.add(existing.get("id"));
            Db.exec("UPDATE " + table + " SET " + String.join(", ", sets) + " WHERE id = ?", params.toArray());
        }
        ctx.ok(Json.shape(Db.one("SELECT * FROM " + table + " WHERE id = ?", existing.get("id"))));
    }

    private static Object valueOf(String field, Object value) {
        if (value == null) return null;
        if (value instanceof Boolean flag) return flag ? 1 : 0;
        if (field.endsWith("Litres") || field.endsWith("Limit") || "rate".equals(field)) return String.valueOf(value);
        return value;
    }

    private static String snake(String field) {
        return field.replaceAll("([A-Z])", "_$1").toLowerCase();
    }

    private static String placeholders(int count) {
        if (count == 0) return "''";
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }

    private static String required(Web.Ctx ctx, String key) {
        String value = ctx.str(key);
        if (value == null || value.isBlank()) throw ApiException.validation(key, key + " is required");
        return value;
    }

    @SuppressWarnings("unchecked")
    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        List<String> out = new ArrayList<>();
        for (Object item : list) if (item != null) out.add(String.valueOf(item));
        return out;
    }
}
