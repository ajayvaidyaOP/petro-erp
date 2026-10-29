package in.petrolflow;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Standalone Java 21 Forecourt Gateway Simulator CLI.
 * Sends heartbeats and simulated totalizer readings over HTTP using X-Device-Key.
 */
public final class GatewaySimulator {
    private GatewaySimulator() {}

    public static void main(String[] args) throws Exception {
        boolean once = Arrays.asList(args).contains("--once");
        String apiBase = env("GATEWAY_API_URL", "http://127.0.0.1:" + env("PORT", "4000") + "/api/v1");
        String deviceKey = env("GATEWAY_DEVICE_KEY", "pfk_sim_demo_baner_gateway_01");
        String nozzleLabel = env("GATEWAY_NOZZLE_LABEL", "D1-N1");
        long intervalMs = Long.parseLong(env("GATEWAY_INTERVAL_MS", "5000"));
        BigDecimal totalizer = new BigDecimal(env("GATEWAY_INITIAL_TOTALIZER", "10500.000"));

        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        int sequence = 1;

        System.out.println("PetroFlow Java Gateway Simulator -> " + apiBase + " (once=" + once + ")");
        while (true) {
            post(client, apiBase + "/gateway/heartbeat", deviceKey, Web.map(
                    "firmwareVersion", "pf-java-sim-21.0",
                    "occurredAt", Clock.nowIso()));

            totalizer = totalizer.add(new BigDecimal("14.250"));
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("nozzleLabel", nozzleLabel);
            payload.put("readingValue", Money.rate(totalizer));
            payload.put("unit", "L");

            List<Map<String, Object>> events = new ArrayList<>();
            events.add(Web.map(
                    "eventId", Clock.newId("sim_ev"),
                    "eventType", "METER_READING",
                    "sequence", sequence++,
                    "occurredAt", Clock.nowIso(),
                    "payload", payload));

            int status = post(client, apiBase + "/gateway/events", deviceKey, Web.map("events", events));
            System.out.println("Tick #" + (sequence - 1) + " -> HTTP " + status + " (" + nozzleLabel + " = " + Money.rate(totalizer) + " L)");
            if (once) break;
            Thread.sleep(intervalMs);
        }
    }

    private static int post(HttpClient client, String url, String key, Object body) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/json")
                .header("X-Device-Key", key)
                .POST(HttpRequest.BodyPublishers.ofString(Json.stringify(body)))
                .build();
        HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());
        return res.statusCode();
    }

    private static String env(String key, String fallback) {
        String val = System.getenv(key);
        return val == null || val.isBlank() ? fallback : val.trim();
    }
}
