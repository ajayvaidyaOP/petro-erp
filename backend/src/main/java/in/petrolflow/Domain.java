package in.petrolflow;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class Domain {
    private Domain() {}

    public static BigDecimal signedLitres(String type, Object quantity) {
        BigDecimal amount = Money.d(quantity).abs();
        if ("ADJUSTMENT".equals(type)) return Money.d(quantity).negate();
        if ("DISPENSED".equals(type) || "TRANSFER_OUT".equals(type)) return amount.negate();
        return amount;
    }

    public static BigDecimal bookStock(String tankId) {
        BigDecimal total = BigDecimal.ZERO;
        for (Map<String, Object> row : Db.all("SELECT type, quantity_litres FROM stock_movements WHERE tank_id = ?", tankId)) {
            total = total.add(signedLitres(Db.str(row, "type"), row.get("quantity_litres")));
        }
        return total;
    }

    public static BigDecimal convertDipToLitres(String tankId, String dipCm) {
        List<Map<String, Object>> points = Db.all(
                "SELECT dip_cm, litres FROM tank_calibration_points WHERE tank_id = ? ORDER BY CAST(dip_cm AS DECIMAL(18,4)) ASC",
                tankId);
        if (points.size() < 2) {
            throw ApiException.unprocessable("No calibration table is configured for this tank — record measured litres instead");
        }
        BigDecimal dip = Money.d(dipCm);
        BigDecimal firstDip = Money.d(points.get(0).get("dip_cm"));
        BigDecimal lastDip = Money.d(points.get(points.size() - 1).get("dip_cm"));
        if (dip.compareTo(firstDip) < 0 || dip.compareTo(lastDip) > 0) {
            throw ApiException.unprocessable("Dip reading falls outside the calibrated range for this tank");
        }
        for (int i = 1; i < points.size(); i++) {
            Map<String, Object> low = points.get(i - 1);
            Map<String, Object> high = points.get(i);
            BigDecimal lowDip = Money.d(low.get("dip_cm"));
            BigDecimal highDip = Money.d(high.get("dip_cm"));
            if (dip.compareTo(lowDip) >= 0 && dip.compareTo(highDip) <= 0) {
                BigDecimal span = highDip.subtract(lowDip);
                if (span.signum() == 0) return Money.d(low.get("litres"));
                BigDecimal ratio = dip.subtract(lowDip).divide(span, 8, java.math.RoundingMode.HALF_UP);
                BigDecimal lowLitres = Money.d(low.get("litres"));
                BigDecimal highLitres = Money.d(high.get("litres"));
                return lowLitres.add(highLitres.subtract(lowLitres).multiply(ratio));
            }
        }
        return Money.d(points.get(points.size() - 1).get("litres"));
    }

    public static List<Map<String, Object>> tankSummary(String stationId) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> tank : Db.all(
                """
                SELECT t.*, p.name AS product_name, p.code AS product_code, p.color AS product_color
                  FROM tanks t JOIN fuel_products p ON p.id = t.product_id
                 WHERE t.station_id = ? ORDER BY t.code
                """, stationId)) {
            BigDecimal book = bookStock(Db.str(tank, "id"));
            Map<String, Object> last = Db.one(
                    """
                    SELECT measured_litres, variance_litres, measured_at, method
                      FROM tank_measurements WHERE tank_id = ? ORDER BY measured_at DESC LIMIT 1
                    """, Db.str(tank, "id"));
            Map<String, Object> card = new LinkedHashMap<>();
            card.put("id", tank.get("id"));
            card.put("stationId", tank.get("station_id"));
            card.put("code", tank.get("code"));
            card.put("name", tank.get("name"));
            card.put("productId", tank.get("product_id"));
            card.put("productName", tank.get("product_name"));
            card.put("productCode", tank.get("product_code"));
            card.put("productColor", tank.get("product_color"));
            card.put("capacityLitres", String.valueOf(tank.get("capacity_litres")));
            card.put("deadStockLitres", String.valueOf(tank.get("dead_stock_litres")));
            card.put("calibrationReference", tank.get("calibration_reference"));
            card.put("status", tank.get("status"));
            card.put("bookStockLitres", Money.litres(book));
            card.put("fillPct", Money.percent(book, tank.get("capacity_litres"), 1));
            card.put("lastMeasuredLitres", last == null ? null : last.get("measured_litres"));
            card.put("lastVarianceLitres", last == null ? null : last.get("variance_litres"));
            card.put("lastMeasuredAt", last == null ? null : last.get("measured_at"));
            card.put("lastMeasurementMethod", last == null ? null : last.get("method"));
            out.add(card);
        }
        return out;
    }

    public static String movement(String tenantId, String stationId, String tankId, String productId, String type, String litres, String refType, String refId, String note, String userId, boolean demo) {
        String id = Clock.newId("mov");
        Db.exec(
                """
                INSERT INTO stock_movements
                  (id, tenant_id, station_id, tank_id, product_id, type, quantity_litres, reference_type, reference_id,
                   occurred_at, note, created_by, is_demo, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, tenantId, stationId, tankId, productId, type, litres, refType, refId,
                Clock.nowIso(), note, userId, demo ? 1 : 0, Clock.nowIso());
        return id;
    }

    public static Map<String, Object> priceAt(String tenantId, String productId, String stationId) {
        String now = Clock.nowIso();
        Map<String, Object> row = stationId == null ? null : Db.one(
                """
                SELECT * FROM fuel_prices
                 WHERE tenant_id = ? AND product_id = ? AND station_id = ?
                   AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
                 ORDER BY effective_from DESC LIMIT 1
                """, tenantId, productId, stationId, now, now);
        if (row == null) {
            row = Db.one(
                    """
                    SELECT * FROM fuel_prices
                     WHERE tenant_id = ? AND product_id = ? AND station_id IS NULL
                       AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
                     ORDER BY effective_from DESC LIMIT 1
                    """, tenantId, productId, now, now);
        }
        return row;
    }

    public static String setting(String key, String tenantId, String stationId, String fallback) {
        Map<String, Object> row = Db.one(
                """
                SELECT value FROM app_settings
                 WHERE `key` = ? AND tenant_id IN (?, '') AND station_id IN (?, '')
                 ORDER BY (tenant_id != '') DESC, (station_id != '') DESC LIMIT 1
                """, key, tenantId == null ? "" : tenantId, stationId == null ? "" : stationId);
        if (row == null || row.get("value") == null || String.valueOf(row.get("value")).isBlank()) return fallback;
        return String.valueOf(row.get("value"));
    }

    public static double settingNumber(String key, String tenantId, String stationId, double fallback) {
        try {
            return Double.parseDouble(setting(key, tenantId, stationId, String.valueOf(fallback)));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    public static boolean dayClosed(String stationId, String date) {
        Map<String, Object> row = Db.one("SELECT status FROM day_closings WHERE station_id = ? AND business_date = ?", stationId, date);
        return row != null && "CLOSED".equals(row.get("status"));
    }

    public static void assertDayOpen(String stationId, String date) {
        if (dayClosed(stationId, date)) {
            throw ApiException.conflict("Business date " + date + " is closed (din band ho chuka hai). Reopen it from Shifts → Day closing before editing entries for that date.");
        }
    }

    public static Map<String, Object> page(long total, int page, int pageSize) {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("page", page);
        meta.put("pageSize", pageSize);
        meta.put("total", total);
        meta.put("totalPages", Math.max(1, (int) Math.ceil(total / (double) pageSize)));
        return meta;
    }

    public static int pageOf(Web.Ctx ctx) {
        try {
            int page = Integer.parseInt(ctx.q("page") == null ? "1" : ctx.q("page"));
            return Math.max(page, 1);
        } catch (NumberFormatException ignored) {
            return 1;
        }
    }

    public static int pageSize(Web.Ctx ctx) {
        try {
            int size = Integer.parseInt(ctx.q("pageSize") == null ? "25" : ctx.q("pageSize"));
            return size <= 0 ? 25 : Math.min(size, 100);
        } catch (NumberFormatException ignored) {
            return 25;
        }
    }

    public static String requireDate(String value, String label) {
        if (value == null || value.isBlank()) return Clock.todayIst();
        if (!Clock.isIsoDate(value)) throw ApiException.badRequest(label + " must be in YYYY-MM-DD format");
        return value;
    }

    public static long ageHours(String iso) {
        if (iso == null) return 0;
        return (System.currentTimeMillis() - Instant.parse(iso).toEpochMilli()) / 3_600_000L;
    }
}
