package in.petrolflow;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class FinanceApi {
    private FinanceApi() {}

    public static void register(Web web) {
        web.get("/finance/customer-ledger", FinanceApi::customerLedger);
        web.get("/finance/customer-statement", FinanceApi::statement);
        web.post("/finance/credit-sales", FinanceApi::creditSale);
        web.get("/finance/supplier-ledger", FinanceApi::supplierLedger);
        web.get("/finance/payments", FinanceApi::payments);
        web.post("/finance/payments", FinanceApi::createPayment);
        web.post("/finance/payments/:id/settle", FinanceApi::settle);
        web.post("/finance/payments/:id/reverse", FinanceApi::reversePayment);
        web.get("/finance/expenses", FinanceApi::expenses);
        web.post("/finance/expenses", FinanceApi::createExpense);
        web.delete("/finance/expenses/:id", FinanceApi::deleteExpense);
        web.get("/finance/reconciliation", FinanceApi::reconciliation);
        web.post("/finance/reconciliation", FinanceApi::saveReconciliation);
        web.post("/finance/reconciliation/:id/approve", FinanceApi::approveReconciliation);
        web.get("/inventory/stock", FinanceApi::stock);
        web.get("/inventory/movements", FinanceApi::movements);
        web.get("/inventory/deliveries", FinanceApi::deliveries);
        web.post("/inventory/deliveries", FinanceApi::createDelivery);
        web.post("/inventory/deliveries/:id/receive", FinanceApi::receive);
        web.post("/inventory/deliveries/:id/dispute", FinanceApi::dispute);
        web.post("/inventory/adjustments", FinanceApi::adjustment);
        web.post("/inventory/opening-stock", FinanceApi::opening);
        web.post("/inventory/transfers", FinanceApi::transfer);
        web.get("/inventory/tanks/:id/ledger", FinanceApi::tankLedger);
    }

    private static void customerLedger(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.read");
        String customerId = required(ctx, "customerId");
        Map<String, Object> customer = Db.one("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", customerId, auth.tenantId());
        if (customer == null) throw ApiException.notFound("Customer not found");
        ctx.ok(Map.of("customer", Json.shape(customer), "entries", Json.shapeAll(Db.all("SELECT * FROM credit_entries WHERE customer_id = ? ORDER BY occurred_at DESC LIMIT 200", customerId))));
    }

    private static void statement(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.read");
        String month = ctx.q("month");
        if (month == null || !month.matches("\\d{4}-\\d{2}")) throw ApiException.unprocessable("month (YYYY-MM) is required");
        Map<String, Object> customer = Db.one("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", ctx.q("customerId"), auth.tenantId());
        if (customer == null) throw ApiException.notFound("Customer not found");
        List<Map<String, Object>> lines = Json.shapeAll(Db.all(
                "SELECT * FROM credit_entries WHERE customer_id = ? AND occurred_at LIKE ? ORDER BY occurred_at",
                customer.get("id"), month + "%"));
        ctx.ok(Map.of("customer", Json.shape(customer), "month", month, "lines", lines, "closingBalance", customer.get("balance"), "generatedAt", Clock.nowIso()));
    }

    private static void creditSale(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("sales.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        Map<String, Object> customer = Db.one("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", requiredBody(ctx, "customerId"), auth.tenantId());
        if (customer == null) throw ApiException.notFound("Customer not found");
        BigDecimal amount = ctx.str("amount") != null ? Money.d(ctx.str("amount")) : Money.d(ctx.str("quantityLitres")).multiply(Money.d(ctx.str("ratePerLitre")));
        if (amount.signum() <= 0) throw ApiException.unprocessable("Amount do, ya litres + rate do — dono me se ek zaroori hai");
        BigDecimal balance = Money.d(customer.get("balance"));
        BigDecimal limit = Money.d(customer.get("credit_limit"));
        if (limit.signum() > 0 && balance.add(amount).compareTo(limit) > 0) {
            throw ApiException.unprocessable("Credit limit exceeded: outstanding " + Money.money(balance) + ", limit " + Money.money(limit));
        }
        String id = Clock.newId("cre");
        String now = Clock.nowIso();
        String slip = ctx.str("slipNumber") == null ? station.get("code") + "-" + Clock.todayIst().replace("-", "") : ctx.str("slipNumber");
        Db.tx(() -> {
            Db.exec(
                    """
                    INSERT INTO credit_entries
                      (id, tenant_id, station_id, customer_id, type, amount, slip_number, vehicle_number, driver_name,
                       product_id, quantity_litres, rate_per_litre, reference, occurred_at, due_date, note, status, created_by, created_at)
                    VALUES (?, ?, ?, ?, 'CREDIT_SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)
                    """,
                    id, auth.tenantId(), station.get("id"), customer.get("id"), Money.money(amount), slip,
                    ctx.str("vehicleNumber"), ctx.str("driverName"), ctx.str("productId"),
                    ctx.str("quantityLitres") == null ? null : Money.litres(ctx.str("quantityLitres")),
                    ctx.str("ratePerLitre") == null ? null : Money.money(ctx.str("ratePerLitre")),
                    ctx.str("reference"), now, ctx.str("dueDate"), ctx.str("note"), auth.userId, now);
            Db.exec("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?", Money.money(balance.add(amount)), now, customer.get("id"));
            return id;
        });
        Auth.audit(auth, "CREDIT_SALE_RECORDED", "CreditEntry", id, Db.str(station, "id"), customer.get("name") + ": " + Money.money(amount));
        ctx.created(Map.of("id", id, "customerId", customer.get("id"), "slipNumber", slip, "amount", Money.money(amount), "newBalance", Money.money(balance.add(amount))));
    }

    private static void supplierLedger(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("suppliers.read");
        Map<String, Object> supplier = Db.one("SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?", required(ctx, "supplierId"), auth.tenantId());
        if (supplier == null) throw ApiException.notFound("Supplier not found");
        ctx.ok(Map.of("supplier", Json.shape(supplier), "entries", Json.shapeAll(Db.all("SELECT * FROM deliveries WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 100", supplier.get("id")))));
    }

    private static void payments(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("payments.read");
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        long total = Db.count("SELECT COUNT(*) AS count FROM payments WHERE tenant_id = ?", auth.tenantId());
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM payments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?", auth.tenantId(), size, (page - 1) * size)), Domain.page(total, page, size));
    }

    private static void createPayment(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("payments.write");
        String id = Clock.newId("pay");
        String now = Clock.nowIso();
        String partyType = ctx.str("partyType") == null ? "CUSTOMER" : ctx.str("partyType");
        Db.exec(
                """
                INSERT INTO payments (id, tenant_id, station_id, direction, party_type, customer_id, supplier_id, amount, mode, status, reference, notes, occurred_at, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), requiredBody(ctx, "stationId"), ctx.str("direction") == null ? "RECEIPT" : ctx.str("direction"),
                partyType, "CUSTOMER".equals(partyType) ? ctx.str("partyId") : null, "SUPPLIER".equals(partyType) ? ctx.str("partyId") : null,
                Money.money(requiredBody(ctx, "amount")), ctx.str("mode") == null ? "CASH" : ctx.str("mode"),
                ctx.str("reference"), ctx.str("note"), now, auth.userId, now);
        if ("CUSTOMER".equals(ctx.str("partyType")) && ctx.str("partyId") != null && "RECEIPT".equals(ctx.str("direction") == null ? "RECEIPT" : ctx.str("direction"))) {
            Map<String, Object> customer = Db.one("SELECT balance FROM customers WHERE id = ?", ctx.str("partyId"));
            if (customer != null) {
                Db.exec("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?", Money.money(Money.d(customer.get("balance")).subtract(Money.d(ctx.str("amount")))), now, ctx.str("partyId"));
                Db.exec(
                        "INSERT INTO credit_entries (id, tenant_id, station_id, customer_id, type, amount, occurred_at, status, created_by, created_at) VALUES (?, ?, ?, ?, 'PAYMENT', ?, ?, 'POSTED', ?, ?)",
                        Clock.newId("cre"), auth.tenantId(), ctx.str("stationId"), ctx.str("partyId"), Money.money(ctx.str("amount")), now, auth.userId, now);
            }
        }
        ctx.created(Json.shape(Db.one("SELECT * FROM payments WHERE id = ?", id)));
    }

    private static void settle(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("payments.write");
        Db.exec("UPDATE payments SET status = 'SETTLED', settled_at = ? WHERE id = ? AND tenant_id = ?", Clock.nowIso(), ctx.p("id"), auth.tenantId());
        ctx.ok(Json.shape(Db.one("SELECT * FROM payments WHERE id = ?", ctx.p("id"))));
    }

    private static void reversePayment(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("payments.write");
        Db.exec("UPDATE payments SET status = 'REVERSED' WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        ctx.ok(Map.of("reversed", true));
    }

    private static void expenses(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("expenses.read");
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        String where = "tenant_id = ?";
        List<Object> params = new ArrayList<>(List.of(auth.tenantId()));
        if (ctx.q("stationId") != null) {
            auth.station(ctx.q("stationId"));
            where += " AND station_id = ?";
            params.add(ctx.q("stationId"));
        }
        if (ctx.q("from") != null) { where += " AND occurred_at >= ?"; params.add(Clock.istDayStart(ctx.q("from"))); }
        if (ctx.q("to") != null) { where += " AND occurred_at <= ?"; params.add(Clock.istDayEnd(ctx.q("to"))); }
        long total = Db.count("SELECT COUNT(*) AS count FROM expenses WHERE " + where, params.toArray());
        Map<String, Object> sum = Db.one("SELECT COALESCE(SUM(CAST(amount AS DECIMAL(20,2))), 0) AS total FROM expenses WHERE " + where, params.toArray());
        params.add(size);
        params.add((page - 1) * size);
        ctx.ok(Map.of("expenses", Json.shapeAll(Db.all("SELECT * FROM expenses WHERE " + where + " ORDER BY occurred_at DESC LIMIT ? OFFSET ?", params.toArray())), "totalAmount", Money.money(sum.get("total"))), Domain.page(total, page, size));
    }

    private static void createExpense(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("expenses.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        String id = Clock.newId("exp");
        String now = Clock.nowIso();
        Db.exec(
                """
                INSERT INTO expenses (id, tenant_id, station_id, category_id, category_name, description, amount, occurred_at, paid_via, reference, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id, auth.tenantId(), station.get("id"), ctx.str("categoryId"), ctx.str("categoryName") == null ? "General" : ctx.str("categoryName"),
                requiredBody(ctx, "description"), Money.money(requiredBody(ctx, "amount")), now,
                ctx.str("paidVia") == null ? "CASH" : ctx.str("paidVia"), ctx.str("reference"), auth.userId, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM expenses WHERE id = ?", id)));
    }

    private static void deleteExpense(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("expenses.write");
        Db.exec("DELETE FROM expenses WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        ctx.ok(Map.of("deleted", true));
    }

    private static void reconciliation(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reconciliation.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        String date = Domain.requireDate(ctx.q("businessDate"), "Date");
        Map<String, Object> existing = Db.one("SELECT * FROM reconciliations WHERE station_id = ? AND business_date = ?", station.get("id"), date);
        String start = Clock.istDayStart(date);
        String end = Clock.istDayEnd(date);
        Map<String, Object> shifts = Db.one(
                "SELECT COALESCE(SUM(CAST(total_value AS DECIMAL(20,2))), 0) AS value FROM shifts WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED')",
                station.get("id"), date);
        String cash = modeTotal(Db.str(station, "id"), start, end, "CASH");
        String digital = Money.money(Money.d(modeTotal(Db.str(station, "id"), start, end, "UPI")).add(Money.d(modeTotal(Db.str(station, "id"), start, end, "CARD"))).add(Money.d(modeTotal(Db.str(station, "id"), start, end, "BANK"))));
        Map<String, Object> expected = new LinkedHashMap<>();
        expected.put("cash", cash);
        expected.put("digital", digital);
        expected.put("cashSales", cash);
        expected.put("digitalSales", digital);
        expected.put("creditSales", modeTotal(Db.str(station, "id"), start, end, "CREDIT"));
        expected.put("cashReceipts", "0.00");
        expected.put("digitalReceipts", "0.00");
        expected.put("cashExpenses", Money.money(Db.one("SELECT COALESCE(SUM(CAST(amount AS DECIMAL(20,2))), 0) AS total FROM expenses WHERE station_id = ? AND paid_via = 'CASH' AND occurred_at >= ? AND occurred_at <= ?", station.get("id"), start, end).get("total")));
        expected.put("cashPayouts", "0.00");
        expected.put("digitalExpenses", "0.00");
        expected.put("digitalPayouts", "0.00");
        expected.put("shiftAggregateLitres", Money.litres(Db.one("SELECT COALESCE(SUM(CAST(total_litres AS DECIMAL(20,3))), 0) AS litres FROM shifts WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED')", station.get("id"), date).get("litres")));
        expected.put("shiftAggregateValue", Money.money(shifts.get("value")));
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("stationId", station.get("id"));
        data.put("businessDate", date);
        data.put("expected", expected);
        data.put("note", "Expected cash and digital figures come from recorded transactions. They are operational estimates, not a bank statement.");
        data.put("history", Json.shapeAll(Db.all("SELECT * FROM reconciliations WHERE station_id = ? ORDER BY business_date DESC LIMIT 30", station.get("id"))));
        data.put("row", existing == null ? null : Json.shape(existing));
        ctx.ok(data);
    }

    private static void saveReconciliation(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reconciliation.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        String id = Clock.newId("rec");
        Db.exec(
                "INSERT INTO reconciliations (id, tenant_id, station_id, business_date, status, notes, created_by, created_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)",
                id, auth.tenantId(), station.get("id"), requiredBody(ctx, "businessDate"), ctx.str("notes"), auth.userId, Clock.nowIso());
        ctx.created(Json.shape(Db.one("SELECT * FROM reconciliations WHERE id = ?", id)));
    }

    private static void approveReconciliation(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("reconciliation.write");
        Db.exec("UPDATE reconciliations SET status = 'APPROVED', approved_by = ?, approved_at = ? WHERE id = ? AND tenant_id = ?", auth.userId, Clock.nowIso(), ctx.p("id"), auth.tenantId());
        ctx.ok(Json.shape(Db.one("SELECT * FROM reconciliations WHERE id = ?", ctx.p("id"))));
    }

    private static void stock(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        List<Map<String, Object>> tanks = Domain.tankSummary(Db.str(station, "id"));
        List<Map<String, Object>> warnings = new ArrayList<>();
        Map<String, Map<String, Object>> byProduct = new LinkedHashMap<>();
        for (Map<String, Object> tank : tanks) {
            if (Money.d(tank.get("bookStockLitres")).signum() < 0) {
                warnings.add(Map.of("level", "error", "message", tank.get("code") + " book stock is negative", "tankId", String.valueOf(tank.get("id"))));
            }
            String productId = String.valueOf(tank.get("productId"));
            Map<String, Object> product = byProduct.computeIfAbsent(productId, ignored -> {
                Map<String, Object> card = new LinkedHashMap<>();
                card.put("productId", productId);
                card.put("name", tank.get("productName"));
                card.put("code", tank.get("productCode"));
                card.put("color", tank.get("productColor"));
                card.put("bookStockLitres", "0.000");
                return card;
            });
            product.put("bookStockLitres", Money.litres(Money.d(product.get("bookStockLitres")).add(Money.d(tank.get("bookStockLitres")))));
        }
        ctx.ok(Map.of("tanks", tanks, "products", new ArrayList<>(byProduct.values()), "warnings", warnings, "recentMovements", Json.shapeAll(Db.all(
                """
                SELECT m.*, t.code AS tank_code, t.name AS tank_name, p.name AS product_name
                  FROM stock_movements m JOIN tanks t ON t.id = m.tank_id JOIN fuel_products p ON p.id = m.product_id
                 WHERE m.station_id = ? ORDER BY m.occurred_at DESC LIMIT 8
                """, station.get("id"))), "stationId", station.get("id")));
    }

    private static void movements(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        long total = Db.count("SELECT COUNT(*) AS count FROM stock_movements WHERE station_id = ?", station.get("id"));
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM stock_movements WHERE station_id = ? ORDER BY occurred_at DESC LIMIT ? OFFSET ?", station.get("id"), size, (page - 1) * size)), Domain.page(total, page, size));
    }

    private static void deliveries(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("deliveries.read");
        Map<String, Object> station = auth.station(required(ctx, "stationId"));
        ctx.ok(Json.shapeAll(Db.all("SELECT * FROM deliveries WHERE station_id = ? ORDER BY created_at DESC LIMIT 100", station.get("id"))));
    }

    private static void createDelivery(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("deliveries.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        String id = Clock.newId("dlv");
        String now = Clock.nowIso();
        Db.exec(
                """
                INSERT INTO deliveries
                  (id, tenant_id, station_id, supplier_id, invoice_number, invoice_date, product_id, tank_id, quantity_litres, rate_per_litre, taxable_amount, tax_amount, total_amount, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)
                """,
                id, auth.tenantId(), station.get("id"), requiredBody(ctx, "supplierId"), requiredBody(ctx, "invoiceNumber"),
                ctx.str("invoiceDate") == null ? Clock.todayIst() : ctx.str("invoiceDate"), requiredBody(ctx, "productId"), requiredBody(ctx, "tankId"),
                Money.litres(requiredBody(ctx, "quantityLitres")),
                Money.rate(ctx.str("ratePerLitre") == null ? "0" : ctx.str("ratePerLitre")),
                Money.money(ctx.str("taxableAmount") == null ? (ctx.str("totalAmount") == null ? "0" : ctx.str("totalAmount")) : ctx.str("taxableAmount")),
                Money.money(ctx.str("taxAmount") == null ? "0" : ctx.str("taxAmount")),
                Money.money(ctx.str("totalAmount") == null ? "0" : ctx.str("totalAmount")),
                auth.userId, now, now);
        ctx.created(Json.shape(Db.one("SELECT * FROM deliveries WHERE id = ?", id)));
    }

    private static void receive(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("deliveries.write");
        Map<String, Object> delivery = Db.one("SELECT * FROM deliveries WHERE id = ? AND tenant_id = ?", ctx.p("id"), auth.tenantId());
        if (delivery == null) throw ApiException.notFound("Delivery not found");
        Domain.movement(auth.tenantId(), Db.str(delivery, "station_id"), Db.str(delivery, "tank_id"), Db.str(delivery, "product_id"),
                "DELIVERY", Money.litres(delivery.get("quantity_litres")), "DELIVERY", Db.str(delivery, "id"), "Tanker receipt", auth.userId, false);
        Db.exec("UPDATE deliveries SET status = 'RECEIVED', updated_at = ? WHERE id = ?", Clock.nowIso(), delivery.get("id"));
        ctx.ok(Json.shape(Db.one("SELECT * FROM deliveries WHERE id = ?", delivery.get("id"))));
    }

    private static void dispute(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("deliveries.write");
        Db.exec("UPDATE deliveries SET status = 'DISPUTED', notes = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", ctx.str("reason"), Clock.nowIso(), ctx.p("id"), auth.tenantId());
        ctx.ok(Json.shape(Db.one("SELECT * FROM deliveries WHERE id = ?", ctx.p("id"))));
    }

    private static String modeTotal(String stationId, String start, String end, String mode) {
        Map<String, Object> row = Db.one(
                "SELECT COALESCE(SUM(CAST(amount AS DECIMAL(20,2))), 0) AS total FROM fuel_transactions WHERE station_id = ? AND payment_mode = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL",
                stationId, mode, start, end);
        return Money.money(row.get("total"));
    }

    private static void adjustment(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.write");
        Map<String, Object> tank = Db.one("SELECT * FROM tanks WHERE id = ?", requiredBody(ctx, "tankId"));
        if (tank == null) throw ApiException.notFound("Tank not found");
        auth.station(Db.str(tank, "station_id"));
        Domain.assertDayOpen(Db.str(tank, "station_id"), Clock.todayIst());
        Domain.movement(auth.tenantId(), Db.str(tank, "station_id"), Db.str(tank, "id"), Db.str(tank, "product_id"),
                "ADJUSTMENT", Money.litres(requiredBody(ctx, "quantityLitres")), "ADJUSTMENT", null, ctx.str("note"), auth.userId, false);
        ctx.created(Map.of("bookStockLitres", Money.litres(Domain.bookStock(Db.str(tank, "id")))));
    }

    private static void opening(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.write");
        Map<String, Object> tank = Db.one("SELECT * FROM tanks WHERE id = ?", requiredBody(ctx, "tankId"));
        if (tank == null) throw ApiException.notFound("Tank not found");
        auth.station(Db.str(tank, "station_id"));
        Domain.movement(auth.tenantId(), Db.str(tank, "station_id"), Db.str(tank, "id"), Db.str(tank, "product_id"),
                "OPENING", Money.litres(requiredBody(ctx, "quantityLitres")), "OPENING", null, "Opening stock", auth.userId, false);
        ctx.created(Map.of("bookStockLitres", Money.litres(Domain.bookStock(Db.str(tank, "id")))));
    }

    private static void transfer(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.write");
        Map<String, Object> from = Db.one("SELECT * FROM tanks WHERE id = ?", requiredBody(ctx, "fromTankId"));
        Map<String, Object> to = Db.one("SELECT * FROM tanks WHERE id = ?", requiredBody(ctx, "toTankId"));
        if (from == null || to == null) throw ApiException.notFound("Tank not found");
        String litres = Money.litres(requiredBody(ctx, "quantityLitres"));
        Domain.movement(auth.tenantId(), Db.str(from, "station_id"), Db.str(from, "id"), Db.str(from, "product_id"), "TRANSFER_OUT", litres, "TRANSFER", null, ctx.str("note"), auth.userId, false);
        Domain.movement(auth.tenantId(), Db.str(to, "station_id"), Db.str(to, "id"), Db.str(to, "product_id"), "TRANSFER_IN", litres, "TRANSFER", null, ctx.str("note"), auth.userId, false);
        ctx.created(Map.of("transferred", litres));
    }

    private static void tankLedger(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("stock.read");
        Map<String, Object> tank = Db.one("SELECT * FROM tanks WHERE id = ?", ctx.p("id"));
        if (tank == null) throw ApiException.notFound("Tank not found");
        auth.station(Db.str(tank, "station_id"));
        ctx.ok(Map.of("tank", Json.shape(tank), "bookStockLitres", Money.litres(Domain.bookStock(ctx.p("id"))), "movements", Json.shapeAll(Db.all("SELECT * FROM stock_movements WHERE tank_id = ? ORDER BY occurred_at DESC LIMIT 200", ctx.p("id")))));
    }

    private static String required(Web.Ctx ctx, String key) {
        String value = ctx.q(key);
        if (value == null || value.isBlank()) throw ApiException.unprocessable(key + " is required");
        return value;
    }

    private static String requiredBody(Web.Ctx ctx, String key) {
        String value = ctx.str(key);
        if (value == null || value.isBlank()) throw ApiException.validation(key, key + " is required");
        return value;
    }
}
