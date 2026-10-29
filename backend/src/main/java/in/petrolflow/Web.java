package in.petrolflow;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
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

    public Web(Config config) {
        this.config = config;
    }

    public void get(String pattern, Handler handler) { routes.add(new Route("GET", pattern, handler)); }
    public void post(String pattern, Handler handler) { routes.add(new Route("POST", pattern, handler)); }
    public void put(String pattern, Handler handler) { routes.add(new Route("PUT", pattern, handler)); }
    public void patch(String pattern, Handler handler) { routes.add(new Route("PATCH", pattern, handler)); }
    public void delete(String pattern, Handler handler) { routes.add(new Route("DELETE", pattern, handler)); }

    public void listen() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(config.host, config.port), 0);
        server.createContext("/", this::dispatch);
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();
        System.out.println("PetroFlow API listening on http://" + config.host + ":" + config.port);
    }

    private void dispatch(HttpExchange exchange) throws IOException {
        Ctx ctx = new Ctx(config, exchange);
        try {
            if ("OPTIONS".equals(ctx.method)) {
                ctx.raw(204, "text/plain", new byte[0]);
                return;
            }
            if (!ctx.path.startsWith("/api/v1")) {
                ctx.error(404, "NOT_FOUND", "No route for " + ctx.method + " " + ctx.path);
                return;
            }
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
            if (!ctx.sent) ctx.error(error.status, error.code, error.getMessage(), error.details);
        } catch (Exception error) {
            error.printStackTrace();
            if (!ctx.sent) ctx.error(500, "INTERNAL_ERROR", config.production ? "An unexpected error occurred" : error.getMessage());
        } finally {
            exchange.close();
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
        private boolean preview;

        Ctx(Config config, HttpExchange exchange) throws IOException {
            this.config = config;
            this.exchange = exchange;
            this.method = exchange.getRequestMethod();
            this.path = exchange.getRequestURI().getPath();
            this.query = parseQuery(exchange.getRequestURI().getRawQuery());
            this.headers = new LinkedHashMap<>();
            exchange.getRequestHeaders().forEach((key, values) -> headers.put(key.toLowerCase(), values.get(0)));
            this.ip = header("x-forwarded-for") != null ? header("x-forwarded-for").split(",")[0].trim() : exchange.getRemoteAddress().getAddress().getHostAddress();
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
            this.preview = isPreview();
            cors();
            String token = cookie(config.cookieName);
            if (!config.production) {
                String authz = header("authorization");
                if (authz != null && authz.regionMatches(true, 0, "Bearer ", 0, 7)) token = authz.substring(7).trim();
            }
            if (token != null) this.auth = Auth.fromToken(token);
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
            raw(status, "application/json; charset=utf-8", Json.stringify(Map.of("error", error)).getBytes(StandardCharsets.UTF_8));
        }

        public void csv(String filename, String text) {
            exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=\"" + filename + "\"");
            raw(200, "text/csv; charset=utf-8", text.getBytes(StandardCharsets.UTF_8));
        }

        public void cookie(String name, String value, String expiresAt) {
            StringBuilder cookie = new StringBuilder();
            cookie.append(name).append('=').append(value).append("; Path=/; HttpOnly");
            if (expiresAt != null) cookie.append("; Expires=").append(httpDate(expiresAt));
            if (preview) cookie.append("; SameSite=None; Secure; Partitioned");
            else {
                cookie.append("; SameSite=Lax");
                if (config.cookieSecure) cookie.append("; Secure");
            }
            exchange.getResponseHeaders().add("Set-Cookie", cookie.toString());
        }

        public void clearCookie(String name) {
            String same = preview ? "; SameSite=None; Secure; Partitioned" : "; SameSite=Lax";
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
                try (OutputStream out = exchange.getResponseBody()) {
                    out.write(bytes);
                }
            } catch (IOException error) {
                throw new RuntimeException(error);
            }
        }

        private void cors() {
            String origin = header("origin");
            if (origin == null) return;
            if (allowed(origin)) {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
                exchange.getResponseHeaders().set("Access-Control-Allow-Credentials", "true");
                exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Device-Key, X-Request-Id, Authorization");
                exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
                exchange.getResponseHeaders().set("Vary", "Origin");
            }
        }

        private boolean allowed(String origin) {
            if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1") || preview) return !config.production || preview;
            return false;
        }

        private boolean isPreview() {
            if (config.production) return false;
            String origin = header("origin");
            String host = header("host");
            if (origin == null) return host != null && host.matches("(?i)[\\w.-]+\\.e2b\\.app(?::\\d+)?");
            try {
                java.net.URI uri = java.net.URI.create(origin);
                if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
                String hostname = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
                if (!hostname.matches("[\\w.-]+\\.e2b\\.app")) return false;
                if (host != null && host.toLowerCase().startsWith(hostname)) return true;
                return config.sandboxId != null && hostname.endsWith("-" + config.sandboxId.toLowerCase() + ".e2b.app");
            } catch (RuntimeException ignored) {
                return false;
            }
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
        for (String part : raw.split("&")) {
            String[] pair = part.split("=", 2);
            out.put(decode(pair[0]), pair.length == 2 ? decode(pair[1]) : "");
        }
        return out;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static String httpDate(String iso) {
        return DateTimeFormatter.RFC_1123_DATE_TIME.format(java.time.Instant.parse(iso).atZone(ZoneOffset.UTC));
    }
}
