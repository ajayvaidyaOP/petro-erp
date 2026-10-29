package in.petrolflow;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class ReportApi {
    private static final String ACCOUNTING = "Figures are operational estimates derived from dispenser totalizers and recorded entries. They are not audited financial statements.";
    private static final String HARDWARE = "Simulated data only until tested against a compatible forecourt controller.";

    private ReportApi() {}

    public static void register(Web web) {
        web.get("/reports/owner-dashboard", ReportApi::dashboard);
        web.get("/reports/combined-dashboard", ReportApi::combined);
        web.get("/reports/dsr", ReportApi::dsr);
        web.get("/reports/stock-loss", ReportApi::stockLoss);
        web.get("/reports/ageing", ReportApi::ageing);
        web.get("/reports/indent", ReportApi::indent);
        web.get("/reports/export/sales-register.csv", ReportApi::csvSales);
        web.get("/reports/export/stock-statement.csv", ReportApi::csvStock);
        web.get("/reports/export/ageing.csv", ReportApi::csvAgeing);
        web.get("/reports/export/lubricants-gst.csv", ReportApi::csvLubricants);
    }

    private static void dashboard(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        String date = Domain.requireDate(ctx.q("date"), "Date");
        String start = Clock.istDayStart(date);
        String end = Clock.istDayEnd(date);
        Map<String, Object> sales = Db.one(
                """
                SELECT COALESCE(SUM(CAST(quantity_litres AS DECIMAL(20,3))), 0) AS litres,
                       COALESCE(SUM(CAST(amount AS DECIMAL(20,2))), 0) AS value, COUNT(*) AS count
                  FROM fuel_transactions
                 WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL
                """, station.get("id"), start, end);
        List<Map<String, Object>> shifts = Db.all(
                "SELECT s.*, u.name AS operator_name FROM shifts s LEFT JOIN users u ON u.id = s.operator_id WHERE s.station_id = ? AND s.business_date = ? ORDER BY s.shift_number",
                station.get("id"), date);
        List<Map<String, Object>> open = Db.all(
                "SELECT s.*, u.name AS operator_name FROM shifts s LEFT JOIN users u ON u.id = s.operator_id WHERE s.station_id = ? AND s.status = 'OPEN'",
                station.get("id"));
        BigDecimal shiftLitres = BigDecimal.ZERO;
        BigDecimal shiftValue = BigDecimal.ZERO;
        int closed = 0;
        int flagged = 0;
        for (Map<String, Object> shift : shifts) {
            if ("FLAGGED".equals(shift.get("status"))) flagged++;
            if ("CLOSED".equals(shift.get("status")) || "FLAGGED".equals(shift.get("status"))) {
                closed++;
                shiftLitres = shiftLitres.add(Money.d(shift.get("total_litres")));
                shiftValue = shiftValue.add(Money.d(shift.get("total_value")));
            }
        }
        List<Map<String, Object>> trend = new ArrayList<>();
        for (int i = 13; i >= 0; i--) {
            String day = Clock.addDays(date, -i);
            Map<String, Object> row = Db.one(
                    "SELECT COALESCE(SUM(CAST(total_litres AS DECIMAL(20,3))), 0) AS litres, COALESCE(SUM(CAST(total_value AS DECIMAL(20,2))), 0) AS value FROM shifts WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED')",
                    station.get("id"), day);
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("date", day.substring(5));
            point.put("litres", Money.litres(row.get("litres")));
            point.put("value", Money.money(row.get("value")));
            point.put("transactionsValue", Money.money(0));
            trend.add(point);
        }
        List<Map<String, Object>> alerts = new ArrayList<>();
        if (flagged > 0) alerts.add(Map.of("level", "warning", "message", flagged + " shift(s) on " + date + " are flagged and awaiting approval.", "to", "/shifts"));
        if (!open.isEmpty()) alerts.add(Map.of("level", "info", "message", open.size() + " shift(s) are currently open.", "to", "/shifts"));
        for (Map<String, Object> tank : Domain.tankSummary(Db.str(station, "id"))) {
            if (Money.d(tank.get("bookStockLitres")).signum() < 0) {
                alerts.add(Map.of("level", "error", "message", tank.get("code") + ": negative book stock", "to", "/tanks"));
            } else if (Money.d(tank.get("capacityLitres")).signum() > 0 && Money.d(tank.get("fillPct")).compareTo(new BigDecimal("15")) < 0) {
                alerts.add(Map.of("level", "warning", "message", tank.get("code") + ": low stock at " + tank.get("fillPct") + "%", "to", "/tanks"));
            }
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("station", Map.of("id", station.get("id"), "name", station.get("name"), "code", station.get("code")));
        data.put("date", date);
        Map<String, Object> salesOut = new LinkedHashMap<>();
        salesOut.put("shiftLitres", Money.litres(shiftLitres));
        salesOut.put("shiftValue", Money.money(shiftValue));
        salesOut.put("shiftCount", closed);
        salesOut.put("transactionLitres", Money.litres(sales.get("litres")));
        salesOut.put("transactionValue", Money.money(sales.get("value")));
        salesOut.put("transactions", Db.num(sales, "count"));
        salesOut.put("byMode", byMode(Db.str(station, "id"), start, end));
        data.put("sales", salesOut);
        data.put("shifts", Json.shapeAll(shifts));
        data.put("openShifts", Json.shapeAll(open));
        data.put("flaggedShifts", flagged);
        data.put("stock", Domain.tankSummary(Db.str(station, "id")));
        data.put("productSplit", productSplit(Db.str(station, "id"), date, auth.tenantId()));
        data.put("devices", Map.of("total", Db.count("SELECT COUNT(*) AS count FROM hardware_devices WHERE station_id = ? AND status != 'DISABLED'", station.get("id")), "online", 0));
        data.put("receivables", Money.money(Db.one("SELECT COALESCE(SUM(CAST(balance AS DECIMAL(20,2))), 0) AS total FROM customers WHERE tenant_id = ?", auth.tenantId()).get("total")));
        data.put("payables", "0.00");
        data.put("trend", trend);
        data.put("alerts", alerts);
        data.put("recentActivity", Json.shapeAll(Db.all("SELECT action, summary, created_at, actor_email FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 8", auth.tenantId())));
        data.put("disclaimer", ACCOUNTING + " " + HARDWARE);
        ctx.ok(data);
    }

    private static void combined(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        if (!auth.allStations || !auth.can("reports.read")) throw ApiException.forbidden();
        String date = Domain.requireDate(ctx.q("date"), "Date");
        List<Map<String, Object>> stations = new ArrayList<>();
        BigDecimal totalValue = BigDecimal.ZERO;
        BigDecimal totalLitres = BigDecimal.ZERO;
        BigDecimal monthTotal = BigDecimal.ZERO;
        for (Map<String, Object> station : Db.all("SELECT id, name, code FROM stations WHERE tenant_id = ? ORDER BY name", auth.tenantId())) {
            Map<String, Object> sums = Db.one(
                    "SELECT COALESCE(SUM(CAST(total_litres AS DECIMAL(20,3))), 0) AS litres, COALESCE(SUM(CAST(total_value AS DECIMAL(20,2))), 0) AS value FROM shifts WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED')",
                    station.get("id"), date);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", station.get("id"));
            row.put("name", station.get("name"));
            row.put("code", station.get("code"));
            Map<String, Object> month = Db.one(
                    "SELECT COALESCE(SUM(CAST(total_value AS DECIMAL(20,2))), 0) AS value FROM shifts WHERE station_id = ? AND business_date LIKE ? AND status IN ('CLOSED','FLAGGED')",
                    station.get("id"), date.substring(0, 7) + "%");
            row.put("litres", Money.litres(sums.get("litres")));
            row.put("value", Money.money(sums.get("value")));
            row.put("monthValue", Money.money(month.get("value")));
            row.put("shortExcess", null);
            row.put("tanks", Domain.tankSummary(Db.str(station, "id")));
            row.put("alerts", List.of());
            row.put("trend", List.of());
            stations.add(row);
            totalValue = totalValue.add(Money.d(sums.get("value")));
            totalLitres = totalLitres.add(Money.d(sums.get("litres")));
            monthTotal = monthTotal.add(Money.d(month.get("value")));
        }
        ctx.ok(Map.of("date", date, "stations", stations, "totalValue", Money.money(totalValue), "totalLitres", Money.litres(totalLitres), "monthValue", Money.money(monthTotal)));
    }

    private static void dsr(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        String date = Domain.requireDate(ctx.q("date"), "Date");
        String start = Clock.istDayStart(date);
        String end = Clock.istDayEnd(date);
        List<Map<String, Object>> nozzleSales = Json.shapeAll(Db.all(
                """
                SELECT snr.id, s.shift_number, s.status AS shift_status, n.label AS nozzle_label, n.number AS nozzle_number,
                       d.code AS dispenser_code, p.name AS product_name, p.code AS product_code, p.color AS product_color,
                       snr.opening_reading, snr.closing_reading, snr.litres_sold, snr.rate, snr.sales_value, snr.variance_litres, snr.status
                  FROM shift_nozzle_readings snr
                  JOIN shifts s ON s.id = snr.shift_id
                  JOIN nozzles n ON n.id = snr.nozzle_id
                  JOIN dispensers d ON d.id = n.dispenser_id
                  JOIN fuel_products p ON p.id = n.product_id
                 WHERE s.station_id = ? AND s.business_date = ? AND s.status != 'REVERSED'
                 ORDER BY s.shift_number, d.code, n.number
                """, station.get("id"), date));
        List<Map<String, Object>> productTotals = new ArrayList<>();
        for (Map<String, Object> row : Db.all(
                """
                SELECT p.name AS product, p.code AS code,
                       COALESCE(SUM(CAST(snr.litres_sold AS DECIMAL(20,3))), 0) AS litres,
                       COALESCE(SUM(CAST(snr.sales_value AS DECIMAL(20,2))), 0) AS value
                  FROM shift_nozzle_readings snr
                  JOIN shifts s ON s.id = snr.shift_id
                  JOIN nozzles n ON n.id = snr.nozzle_id
                  JOIN fuel_products p ON p.id = n.product_id
                 WHERE s.station_id = ? AND s.business_date = ? AND s.status IN ('CLOSED','FLAGGED')
                 GROUP BY p.id, p.name, p.code ORDER BY p.code
                """, station.get("id"), date)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("product", row.get("product"));
            item.put("code", row.get("code"));
            item.put("litres", Money.litres(row.get("litres")));
            item.put("value", Money.money(row.get("value")));
            productTotals.add(item);
        }
        List<Map<String, Object>> shifts = Db.all(
                "SELECT s.*, u.name AS operator_name FROM shifts s LEFT JOIN users u ON u.id = s.operator_id WHERE s.station_id = ? AND s.business_date = ? ORDER BY s.shift_number",
                station.get("id"), date);
        Map<String, Object> tx = Db.one(
                "SELECT COALESCE(SUM(CAST(quantity_litres AS DECIMAL(20,3))), 0) AS litres, COALESCE(SUM(CAST(amount AS DECIMAL(20,2))), 0) AS value FROM fuel_transactions WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL",
                station.get("id"), start, end);
        BigDecimal litres = BigDecimal.ZERO;
        BigDecimal value = BigDecimal.ZERO;
        for (Map<String, Object> shift : shifts) {
            if ("CLOSED".equals(shift.get("status")) || "FLAGGED".equals(shift.get("status"))) {
                litres = litres.add(Money.d(shift.get("total_litres")));
                value = value.add(Money.d(shift.get("total_value")));
            }
        }
        List<Map<String, Object>> transactions = Json.shapeAll(Db.all(
                """
                SELECT ft.*, p.name AS product_name, c.name AS customer_name
                  FROM fuel_transactions ft
                  LEFT JOIN fuel_products p ON p.id = ft.product_id
                  LEFT JOIN customers c ON c.id = ft.customer_id
                 WHERE ft.station_id = ? AND ft.occurred_at >= ? AND ft.occurred_at <= ? AND ft.voided_at IS NULL
                 ORDER BY ft.occurred_at DESC
                """, station.get("id"), start, end));
        List<Map<String, Object>> expenses = Json.shapeAll(Db.all(
                "SELECT * FROM expenses WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at DESC",
                station.get("id"), start, end));
        List<Map<String, Object>> deliveries = Json.shapeAll(Db.all(
                """
                SELECT d.*, p.name AS product_name, s.name AS supplier_name
                  FROM deliveries d
                  LEFT JOIN fuel_products p ON p.id = d.product_id
                  LEFT JOIN suppliers s ON s.id = d.supplier_id
                 WHERE d.station_id = ? AND d.invoice_date = ?
                 ORDER BY d.created_at DESC
                """, station.get("id"), date));
        List<Map<String, Object>> receipts = Json.shapeAll(Db.all(
                """
                SELECT pay.*, c.name AS customer_name
                  FROM payments pay LEFT JOIN customers c ON c.id = pay.customer_id
                 WHERE pay.station_id = ? AND pay.direction = 'RECEIPT' AND pay.status != 'REVERSED'
                   AND pay.occurred_at >= ? AND pay.occurred_at <= ?
                 ORDER BY pay.occurred_at DESC
                """, station.get("id"), start, end));
        BigDecimal expSum = BigDecimal.ZERO;
        for (Map<String, Object> e : expenses) expSum = expSum.add(Money.d(e.get("amount")));
        BigDecimal recSum = BigDecimal.ZERO;
        for (Map<String, Object> r : receipts) recSum = recSum.add(Money.d(r.get("amount")));
        BigDecimal purSum = BigDecimal.ZERO;
        for (Map<String, Object> d : deliveries) if ("RECEIVED".equals(d.get("status"))) purSum = purSum.add(Money.d(d.get("totalAmount")));
        Map<String, Object> recon = Db.one("SELECT * FROM reconciliations WHERE station_id = ? AND business_date = ?", station.get("id"), date);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("station", Web.map("name", station.get("name"), "code", station.get("code"), "address", station.get("address") == null ? "" : station.get("address"), "city", station.get("city") == null ? "" : station.get("city"), "state", station.get("state") == null ? "" : station.get("state")));
        data.put("date", date);
        data.put("generatedAt", Clock.nowIso());
        data.put("nozzleSales", nozzleSales);
        data.put("productTotals", productTotals);
        data.put("shifts", Json.shapeAll(shifts));
        data.put("transactions", transactions);
        data.put("expenses", expenses);
        data.put("deliveries", deliveries);
        data.put("receipts", receipts);
        data.put("stock", Domain.tankSummary(Db.str(station, "id")));
        data.put("reconciliation", recon == null ? null : Json.shape(recon));
        data.put("paymentMix", byMode(Db.str(station, "id"), start, end));
        data.put("totals", Web.map(
                "aggregateLitres", Money.litres(litres),
                "aggregateEstimatedValue", Money.money(value),
                "transactionLitres", Money.litres(tx.get("litres")),
                "transactionValue", Money.money(tx.get("value")),
                "expenses", Money.money(expSum),
                "receipts", Money.money(recSum),
                "purchases", Money.money(purSum)));
        data.put("notes", List.of(ACCOUNTING));
        ctx.ok(data);
    }

    private static void stockLoss(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        String month = ctx.q("month") == null ? Clock.todayIst().substring(0, 7) : ctx.q("month");
        String monthStartIso = Clock.istDayStart(month + "-01");
        String nextMonthIso = Clock.istDayStart(Clock.addDays(month + "-28", 4).substring(0, 8) + "01");
        List<Map<String, Object>> products = Db.all(
                """
                SELECT DISTINCT p.id, p.name, p.code, p.category
                  FROM tanks t JOIN fuel_products p ON p.id = t.product_id
                 WHERE t.station_id = ? ORDER BY p.code
                """, station.get("id"));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> prod : products) {
            String pid = Db.str(prod, "id");
            BigDecimal opening = BigDecimal.ZERO;
            BigDecimal receipts = BigDecimal.ZERO;
            BigDecimal dispensed = BigDecimal.ZERO;
            BigDecimal adjustments = BigDecimal.ZERO;
            for (Map<String, Object> m : Db.all(
                    "SELECT type, quantity_litres, occurred_at FROM stock_movements WHERE station_id = ? AND product_id = ? AND occurred_at < ?",
                    station.get("id"), pid, nextMonthIso)) {
                String occ = Db.str(m, "occurred_at");
                String type = Db.str(m, "type");
                BigDecimal signed = Domain.signedLitres(type, m.get("quantity_litres"));
                if (occ.compareTo(monthStartIso) < 0) {
                    opening = opening.add(signed);
                } else if ("OPENING".equals(type)) {
                    opening = opening.add(signed);
                } else if ("DELIVERY".equals(type) || "TRANSFER_IN".equals(type)) {
                    receipts = receipts.add(signed);
                } else if ("DISPENSED".equals(type) || "TRANSFER_OUT".equals(type)) {
                    dispensed = dispensed.add(signed.abs());
                } else if ("ADJUSTMENT".equals(type)) {
                    adjustments = adjustments.add(signed);
                }
            }
            BigDecimal closingBook = opening.add(receipts).subtract(dispensed).add(adjustments);
            List<Map<String, Object>> prodTanks = Db.all("SELECT id FROM tanks WHERE station_id = ? AND product_id = ?", station.get("id"), pid);
            BigDecimal physical = BigDecimal.ZERO;
            boolean allMeasured = !prodTanks.isEmpty();
            for (Map<String, Object> t : prodTanks) {
                Map<String, Object> tm = Db.one(
                        "SELECT measured_litres FROM tank_measurements WHERE tank_id = ? AND measured_at < ? ORDER BY measured_at DESC LIMIT 1",
                        t.get("id"), nextMonthIso);
                if (tm == null || tm.get("measured_litres") == null) { allMeasured = false; break; }
                physical = physical.add(Money.d(tm.get("measured_litres")));
            }
            String normPct = "PETROL".equalsIgnoreCase(Db.str(prod, "category")) ? "0.75" : "0.25";
            String physicalStr = allMeasured ? Money.litres(physical) : null;
            String lossGainStr = null;
            String pctStr = null;
            String status = "NO_DIP";
            if (allMeasured) {
                BigDecimal lg = physical.subtract(closingBook);
                lossGainStr = Money.litres(lg);
                if (dispensed.signum() > 0) {
                    BigDecimal pct = lg.multiply(new BigDecimal("100")).divide(dispensed, 2, java.math.RoundingMode.HALF_UP);
                    pctStr = pct.toPlainString();
                    if (pct.compareTo(new BigDecimal("-" + normPct)) < 0) status = "BEYOND_NORM";
                    else if (pct.compareTo(new BigDecimal(normPct)) > 0) status = "GAIN_CHECK";
                    else status = "WITHIN_NORM";
                } else {
                    status = "WITHIN_NORM";
                }
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("productCode", prod.get("code"));
            row.put("productName", prod.get("name"));
            row.put("stationName", station.get("name"));
            row.put("openingLitres", Money.litres(opening));
            row.put("receiptsLitres", Money.litres(receipts));
            row.put("dispensedLitres", Money.litres(dispensed));
            row.put("adjustmentsLitres", Money.litres(adjustments));
            row.put("closingBookLitres", Money.litres(closingBook));
            row.put("physicalLitres", physicalStr);
            row.put("lossGainLitres", lossGainStr);
            row.put("lossGainPctOfSales", pctStr);
            row.put("normPct", normPct);
            row.put("status", status);
            rows.add(row);
        }
        ctx.ok(Web.map("month", month, "rows", rows));
    }

    private static void ageing(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        if (ctx.q("stationId") != null && !"all".equals(ctx.q("stationId"))) auth.station(ctx.q("stationId"));
        ctx.ok(fifoAgeing(auth.tenantId()));
    }

    private static Map<String, Object> fifoAgeing(String tenantId) {
        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal outstanding = BigDecimal.ZERO;
        BigDecimal b0 = BigDecimal.ZERO;
        BigDecimal b31 = BigDecimal.ZERO;
        BigDecimal b61 = BigDecimal.ZERO;
        BigDecimal b90 = BigDecimal.ZERO;
        long today = LocalDate.parse(Clock.todayIst()).atTime(12, 0).toInstant(ZoneOffset.ofHoursMinutes(5, 30)).toEpochMilli();
        for (Map<String, Object> customer : Db.all("SELECT id, code, name, phone, credit_limit FROM customers WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY name", tenantId)) {
            BigDecimal paid = BigDecimal.ZERO;
            for (Map<String, Object> payment : Db.all("SELECT amount FROM credit_entries WHERE customer_id = ? AND type = 'PAYMENT' AND status = 'POSTED'", customer.get("id"))) {
                paid = paid.add(Money.d(payment.get("amount")).abs());
            }
            BigDecimal d0 = BigDecimal.ZERO, d31 = BigDecimal.ZERO, d61 = BigDecimal.ZERO, d90 = BigDecimal.ZERO, due = BigDecimal.ZERO;
            String oldestUnpaidAt = null;
            for (Map<String, Object> sale : Db.all("SELECT amount, occurred_at FROM credit_entries WHERE customer_id = ? AND type = 'CREDIT_SALE' AND status = 'POSTED' ORDER BY occurred_at", customer.get("id"))) {
                BigDecimal remaining = Money.d(sale.get("amount")).abs();
                if (paid.signum() > 0) {
                    BigDecimal used = remaining.min(paid);
                    remaining = remaining.subtract(used);
                    paid = paid.subtract(used);
                }
                if (remaining.signum() <= 0) continue;
                if (oldestUnpaidAt == null) oldestUnpaidAt = Db.str(sale, "occurred_at");
                due = due.add(remaining);
                long age = (today - Instant.parse(Db.str(sale, "occurred_at")).toEpochMilli()) / 86_400_000L;
                if (age <= 30) d0 = d0.add(remaining);
                else if (age <= 60) d31 = d31.add(remaining);
                else if (age <= 90) d61 = d61.add(remaining);
                else d90 = d90.add(remaining);
            }
            if (due.signum() <= 0) continue;
            BigDecimal limit = Money.d(customer.get("credit_limit"));
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("customerId", customer.get("id"));
            row.put("code", customer.get("code"));
            row.put("name", customer.get("name"));
            row.put("phone", customer.get("phone"));
            row.put("creditLimit", Money.money(limit));
            row.put("outstanding", Money.money(due));
            row.put("bucket0To30", Money.money(d0));
            row.put("bucket31To60", Money.money(d31));
            row.put("bucket61To90", Money.money(d61));
            row.put("bucket90Plus", Money.money(d90));
            row.put("oldestUnpaidAt", oldestUnpaidAt);
            row.put("overLimit", limit.signum() > 0 && due.compareTo(limit) > 0);
            rows.add(row);
            outstanding = outstanding.add(due);
            b0 = b0.add(d0);
            b31 = b31.add(d31);
            b61 = b61.add(d61);
            b90 = b90.add(d90);
        }
        return Web.map(
                "asOf", Clock.todayIst(),
                "rows", rows,
                "totals", Web.map("outstanding", Money.money(outstanding), "bucket0To30", Money.money(b0), "bucket31To60", Money.money(b31), "bucket61To90", Money.money(b61), "bucket90Plus", Money.money(b90)),
                "note", "Payments FIFO tareeke se sabse purani udhaar me lage mane gaye hain.");
    }

    private static void indent(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        int days = 14;
        String sinceIso = Clock.istDayStart(Clock.addDays(Clock.todayIst(), -days));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> tank : Domain.tankSummary(Db.str(station, "id"))) {
            Map<String, Object> disp = Db.one(
                    "SELECT COALESCE(SUM(ABS(CAST(quantity_litres AS DECIMAL(20,3)))), 0) AS litres FROM stock_movements WHERE tank_id = ? AND type = 'DISPENSED' AND occurred_at >= ?",
                    tank.get("id"), sinceIso);
            BigDecimal avgDaily = Money.d(disp.get("litres")).divide(BigDecimal.valueOf(days), 3, java.math.RoundingMode.HALF_UP);
            BigDecimal cap = Money.d(tank.get("capacityLitres"));
            BigDecimal book = Money.d(tank.get("bookStockLitres"));
            BigDecimal ullage = cap.multiply(new BigDecimal("0.95")).subtract(book).max(BigDecimal.ZERO);
            BigDecimal cover = avgDaily.signum() > 0 ? book.divide(avgDaily, 1, java.math.RoundingMode.HALF_UP) : null;
            BigDecimal suggested = ullage.divide(new BigDecimal("1000"), 0, java.math.RoundingMode.FLOOR).multiply(new BigDecimal("1000"));
            String priority = cover != null && cover.compareTo(new BigDecimal("2")) < 0 ? "ORDER_NOW"
                    : (cover != null && cover.compareTo(new BigDecimal("4")) < 0 ? "ORDER_SOON" : "ADEQUATE");
            rows.add(Web.map(
                    "tankId", tank.get("id"),
                    "tankCode", tank.get("code"),
                    "productName", tank.get("productName"),
                    "productColor", tank.get("productColor"),
                    "bookStockLitres", tank.get("bookStockLitres"),
                    "capacityLitres", tank.get("capacityLitres"),
                    "fillPct", tank.get("fillPct"),
                    "ullageLitres", Money.litres(ullage),
                    "avgDailySalesLitres", Money.litres(avgDaily),
                    "daysOfCover", cover == null ? null : cover.toPlainString(),
                    "suggestedOrderLitres", Money.litres(suggested),
                    "priority", priority));
        }
        ctx.ok(Web.map("stationId", station.get("id"), "basedOnDays", days, "rows", rows));
    }

    private static List<Map<String, Object>> exportStations(Auth auth, Web.Ctx ctx) {
        String sid = ctx.q("stationId");
        if (sid == null || sid.isBlank() || "all".equalsIgnoreCase(sid)) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> s : Db.all("SELECT * FROM stations WHERE tenant_id = ? ORDER BY name", auth.tenantId())) {
                if (auth.allStations || auth.stationIds.contains(Db.str(s, "id"))) out.add(s);
            }
            return out;
        }
        return List.of(auth.station(sid));
    }

    private static void csvSales(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        List<Map<String, Object>> stations = exportStations(auth, ctx);
        String month = ctx.q("month") == null ? Clock.todayIst().substring(0, 7) : ctx.q("month");
        StringBuilder csv = new StringBuilder("station,date,shift,product,litres,amount\n");
        for (Map<String, Object> station : stations) {
            for (Map<String, Object> row : Db.all(
                    """
                    SELECT s.business_date, s.shift_number, p.name AS product, snr.litres_sold, snr.sales_value
                      FROM shift_nozzle_readings snr
                      JOIN shifts s ON s.id = snr.shift_id
                      JOIN nozzles n ON n.id = snr.nozzle_id
                      JOIN fuel_products p ON p.id = n.product_id
                     WHERE s.station_id = ? AND s.business_date LIKE ? AND s.status IN ('CLOSED','FLAGGED')
                     ORDER BY s.business_date, s.shift_number, p.name
                    """, station.get("id"), month + "%")) {
                csv.append(csvCell(station.get("code"))).append(',')
                        .append(csvCell(row.get("business_date"))).append(',')
                        .append(csvCell(row.get("shift_number"))).append(',')
                        .append(csvCell(row.get("product"))).append(',')
                        .append(csvCell(row.get("litres_sold"))).append(',')
                        .append(csvCell(row.get("sales_value"))).append('\n');
            }
        }
        ctx.csv("sales-register.csv", csv.toString());
    }

    private static void csvStock(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        List<Map<String, Object>> stations = exportStations(auth, ctx);
        StringBuilder csv = new StringBuilder("station,tank,product,book_litres,physical_litres,variance_litres\n");
        for (Map<String, Object> station : stations) {
            for (Map<String, Object> tank : Domain.tankSummary(Db.str(station, "id"))) {
                csv.append(csvCell(station.get("code"))).append(',')
                        .append(csvCell(tank.get("code"))).append(',')
                        .append(csvCell(tank.get("productName"))).append(',')
                        .append(csvCell(tank.get("bookStockLitres"))).append(',')
                        .append(csvCell(tank.get("lastMeasuredLitres"))).append(',')
                        .append(csvCell(tank.get("lastVarianceLitres"))).append('\n');
            }
        }
        ctx.csv("stock-statement.csv", csv.toString());
    }

    private static void csvAgeing(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        StringBuilder csv = new StringBuilder("customer,code,outstanding,0_to_30,31_to_60,61_to_90,90_plus\n");
        Object rows = fifoAgeing(auth.tenantId()).get("rows");
        if (rows instanceof List<?> list) {
            for (Object item : list) {
                Map<String, Object> row = Json.object(item);
                csv.append(csvCell(row.get("name"))).append(',')
                        .append(csvCell(row.get("code"))).append(',')
                        .append(csvCell(row.get("outstanding"))).append(',')
                        .append(csvCell(row.get("bucket0To30"))).append(',')
                        .append(csvCell(row.get("bucket31To60"))).append(',')
                        .append(csvCell(row.get("bucket61To90"))).append(',')
                        .append(csvCell(row.get("bucket90Plus"))).append('\n');
            }
        }
        ctx.csv("ageing.csv", csv.toString());
    }

    private static void csvLubricants(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reports.read");
        String stationId = ctx.q("stationId");
        if (stationId != null && !stationId.isBlank()) auth.station(stationId);
        String month = ctx.q("month") == null ? Clock.todayIst().substring(0, 7) : ctx.q("month");
        StringBuilder csv = new StringBuilder("date,product,hsn,qty,rate,amount,gst_rate\n");
        List<Map<String, Object>> rows = stationId == null || stationId.isBlank()
                ? Db.all("SELECT m.occurred_at, p.name, p.hsn_code, m.quantity, m.rate, m.amount, p.gst_rate_pct FROM lube_movements m JOIN lube_products p ON p.id = m.product_id WHERE m.tenant_id = ? AND m.type = 'SALE' AND m.occurred_at LIKE ? ORDER BY m.occurred_at", auth.tenantId(), month + "%")
                : Db.all("SELECT m.occurred_at, p.name, p.hsn_code, m.quantity, m.rate, m.amount, p.gst_rate_pct FROM lube_movements m JOIN lube_products p ON p.id = m.product_id WHERE m.station_id = ? AND m.type = 'SALE' AND m.occurred_at LIKE ? ORDER BY m.occurred_at", stationId, month + "%");
        for (Map<String, Object> row : rows) {
            csv.append(csvCell(row.get("occurred_at"))).append(',')
                    .append(csvCell(row.get("name"))).append(',')
                    .append(csvCell(row.get("hsn_code"))).append(',')
                    .append(csvCell(row.get("quantity"))).append(',')
                    .append(csvCell(row.get("rate"))).append(',')
                    .append(csvCell(row.get("amount"))).append(',')
                    .append(csvCell(row.get("gst_rate_pct"))).append('\n');
        }
        ctx.csv("lubricants-gst.csv", csv.toString());
    }

    private static String csvCell(Object value) {
        String text = value == null ? "" : String.valueOf(value);
        if (text.contains(",") || text.contains("\"") || text.contains("\n")) return "\"" + text.replace("\"", "\"\"") + "\"";
        return text;
    }

    private static List<Map<String, Object>> productSplit(String stationId, String date, String tenantId) {
        return Json.shapeAll(Db.all(
                """
                SELECT p.id, p.name, p.code, p.color,
                       COALESCE(SUM(CAST(snr.litres_sold AS DECIMAL(20,3))), 0) AS shift_litres,
                       COALESCE(SUM(CAST(snr.sales_value AS DECIMAL(20,2))), 0) AS shift_value
                  FROM fuel_products p
                  LEFT JOIN nozzles n ON n.product_id = p.id AND n.station_id = ?
                  LEFT JOIN shift_nozzle_readings snr ON snr.nozzle_id = n.id
                  LEFT JOIN shifts s ON s.id = snr.shift_id AND s.business_date = ? AND s.status IN ('CLOSED','FLAGGED')
                 WHERE p.tenant_id = ?
                 GROUP BY p.id, p.name, p.code, p.color
                 ORDER BY p.code
                """, stationId, date, tenantId));
    }

    private static Map<String, String> byMode(String stationId, String start, String end) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map<String, Object> row : Db.all(
                "SELECT payment_mode, COALESCE(SUM(CAST(amount AS DECIMAL(20,2))), 0) AS total FROM fuel_transactions WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL GROUP BY payment_mode",
                stationId, start, end)) {
            out.put(Db.str(row, "payment_mode"), Money.money(row.get("total")));
        }
        return out;
    }

    private static String required(Web.Ctx ctx, String key) {
        String value = ctx.q(key);
        if (value == null || value.isBlank()) throw ApiException.unprocessable(key + " is required");
        return value;
    }
}
