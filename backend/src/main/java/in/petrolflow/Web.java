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
import java.util.concurrent.Executors;

public final class Web {
    private final Config config;
    private final List<Route> routes = new ArrayList<>();
    private final Path spaDist;
    private HttpServer server;

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
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();
        System.out.println("PetroFlow Java API listening on http://" + config.host + ":" + config.port);
    }

    public void stop() {
        if (server != null) server.stop(0);
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
                route.handler.handle(ctx);
                if (!ctx.sent) ctx.ok(Map.of());
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
