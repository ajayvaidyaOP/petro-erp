package in.petrolflow;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AuthRoutes {
    private AuthRoutes() {}

    public static void register(Web web) {
        web.post("/auth/login", AuthRoutes::login);
        web.post("/auth/logout", AuthRoutes::logout);
        web.get("/auth/me", AuthRoutes::me);
        web.post("/auth/change-password", AuthRoutes::changePassword);
        web.get("/auth/demo-accounts", AuthRoutes::demoAccounts);
        web.get("/health", ctx -> ctx.ok(Map.of("ok", true, "service", "petroflow-java", "time", Clock.nowIso())));
    }

    private static void login(Web.Ctx ctx) {
        String email = ctx.str("email");
        String password = ctx.str("password");
        if (email == null || password == null) throw ApiException.validation("email", "Email and password are required");
        Map<String, Object> row = Db.one("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
        if (row == null || !Passwords.verify(password, Db.str(row, "password_hash"))) {
            throw ApiException.unauthorized("Invalid email or password");
        }
        if (!"ACTIVE".equals(row.get("status"))) throw ApiException.forbidden("This account is disabled");
        String role = Db.str(row, "role_key");
        if (!List.of("OWNER", "MANAGER", "STAFF", "SUPER_ADMIN").contains(role)) {
            throw ApiException.forbidden("This account uses a retired role. Ask the owner to create a staff login.");
        }
        if (row.get("tenant_id") != null) {
            Map<String, Object> tenant = Db.one("SELECT status FROM tenants WHERE id = ?", row.get("tenant_id"));
            if (tenant == null || !"ACTIVE".equals(tenant.get("status"))) {
                throw ApiException.forbidden("This organization is suspended. Contact your platform administrator.");
            }
        }
        Auth auth = Auth.load(Db.str(row, "id"), null);
        Map<String, Object> session = Auth.session(auth, ctx.config, ctx.ip, ctx.header("user-agent"));
        ctx.cookie(ctx.config.cookieName, String.valueOf(session.get("token")), String.valueOf(session.get("expiresAt")));
        Db.exec("UPDATE users SET last_login_at = ? WHERE id = ?", Clock.nowIso(), auth.userId);
        Auth.audit(auth, "AUTH_LOGIN", "User", auth.userId, null, "Login from " + ctx.ip);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("user", auth.publicUser());
        body.put("sessionExpiresAt", session.get("expiresAt"));
        if (!ctx.config.production) {
            body.put("sessionToken", session.get("token"));
            if (ctx.preview) body.put("previewToken", session.get("token"));
        }
        ctx.ok(body);
    }

    private static void logout(Web.Ctx ctx) {
        Auth auth = ctx.auth;
        if (auth != null && auth.sessionId != null) {
            Db.exec("UPDATE sessions SET revoked_at = ? WHERE id = ?", Clock.nowIso(), auth.sessionId);
            Auth.audit(auth, "AUTH_LOGOUT", "User", auth.userId, null, "Logout");
        }
        ctx.clearCookie(ctx.config.cookieName);
        ctx.ok(Map.of("loggedOut", true));
    }

    private static void me(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("user", auth.publicUser());
        body.put("tenant", auth.tenantId == null ? null : Json.shape(Db.one("SELECT * FROM tenants WHERE id = ?", auth.tenantId)));
        Map<String, Object> subscription = auth.tenantId == null ? null : Json.shape(Db.one(
                """
                SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.max_stations, p.max_users, p.max_dispensers, p.features
                  FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
                 WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1
                """, auth.tenantId), List.of("features"));
        body.put("subscription", subscription);
        List<Map<String, Object>> stations = auth.tenantId == null ? List.of() : Json.shapeAll(auth.allStations
                ? Db.all("SELECT id, name, code, status, city, state FROM stations WHERE tenant_id = ? ORDER BY name", auth.tenantId)
                : Db.all("SELECT id, name, code, status, city, state FROM stations WHERE tenant_id = ? AND id IN (" + placeholders(auth.stationIds.size()) + ") ORDER BY name", stationArgs(auth)));
        body.put("stations", stations);
        body.put("permissions", new ArrayList<>(auth.permissions));
        body.put("roleScope", auth.roleScope);
        body.put("isSuperAdmin", auth.superAdmin);
        body.put("demoMode", ctx.config.demoTools);
        ctx.ok(body);
    }

    private static void changePassword(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        String current = ctx.str("currentPassword");
        String next = ctx.str("newPassword");
        Map<String, Object> row = Db.one("SELECT password_hash FROM users WHERE id = ?", auth.userId);
        if (row == null || !Passwords.verify(current, Db.str(row, "password_hash"))) {
            throw ApiException.unauthorized("Current password is incorrect");
        }
        Passwords.assertStrength(next);
        if (current.equals(next)) throw ApiException.conflict("New password must differ from the current password");
        Db.exec("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?", Passwords.hash(next), Clock.nowIso(), auth.userId);
        if (auth.sessionId != null) {
            Db.exec("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL", Clock.nowIso(), auth.userId, auth.sessionId);
        }
        ctx.ok(Map.of("changed", true));
    }

    private static void demoAccounts(Web.Ctx ctx) {
        if (!ctx.config.demoTools) throw ApiException.notFound("Demo accounts are disabled");
        List<Map<String, Object>> accounts = new ArrayList<>();
        for (Map<String, Object> row : Db.all(
                """
                SELECT u.email, u.name, u.role_key, t.name AS tenant_name
                  FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
                 WHERE u.is_demo = 1 AND u.status = 'ACTIVE' AND u.role_key IN ('OWNER','MANAGER','STAFF')
                 ORDER BY u.email
                """)) {
            Map<String, Object> account = new LinkedHashMap<>();
            account.put("email", row.get("email"));
            account.put("name", row.get("name"));
            account.put("roleKey", row.get("role_key"));
            account.put("tenantName", row.get("tenant_name"));
            accounts.add(account);
        }
        ctx.ok(Map.of(
                "demoMode", true,
                "password", ctx.config.demoPassword,
                "accounts", accounts,
                "warning", "Demo credentials are for local evaluation only. Never enable demo accounts in production."));
    }

    private static Object[] stationArgs(Auth auth) {
        List<Object> args = new ArrayList<>();
        args.add(auth.tenantId);
        args.addAll(auth.stationIds);
        return args.toArray();
    }

    private static String placeholders(int count) {
        if (count == 0) return "''";
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }
}
