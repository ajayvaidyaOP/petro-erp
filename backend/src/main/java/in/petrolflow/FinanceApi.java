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
        web.patch("/finance/payments/:id/settle", FinanceApi::settle);
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
        List<Map<String, Object>> entries = Db.all(
                """
                SELECT ce.*, st.name AS station_name, u.name AS created_by_name, p.name AS product_name
                  FROM credit_entries ce
                  LEFT JOIN stations st ON st.id = ce.station_id
                  LEFT JOIN users u ON u.id = ce.created_by
                  LEFT JOIN fuel_products p ON p.id = ce.product_id
                 WHERE ce.customer_id = ? AND ce.status = 'POSTED'
                 ORDER BY ce.occurred_at ASC, ce.created_at ASC
                """, customerId);
        BigDecimal running = Money.d(customer.get("opening_balance"));
        BigDecimal overdueTotal = BigDecimal.ZERO;
        String today = Clock.todayIst();
        List<Map<String, Object>> ledger = new ArrayList<>();
        for (Map<String, Object> entry : entries) {
            String type = Db.str(entry, "type");
            BigDecimal rawAmt = Money.d(entry.get("amount"));
            BigDecimal absAmt = rawAmt.abs();
            if ("CREDIT_SALE".equals(type)) running = running.add(absAmt);
            else if ("PAYMENT".equals(type)) running = running.subtract(absAmt);
            else running = running.add(rawAmt);
            String due = Db.str(entry, "due_date");
            boolean overdue = "CREDIT_SALE".equals(type) && due != null && due.compareTo(today) < 0;
            if (overdue) overdueTotal = overdueTotal.add(absAmt);
            Map<String, Object> shaped = Json.shape(entry);
            shaped.put("amount", Money.money(absAmt));
            shaped.put("debit", "CREDIT_SALE".equals(type) ? Money.money(absAmt) : "0.00");
            shaped.put("credit", "PAYMENT".equals(type) ? Money.money(absAmt) : "0.00");
            shaped.put("runningBalance", Money.money(running));
            shaped.put("overdue", overdue);
            ledger.add(shaped);
        }
        BigDecimal limit = Money.d(customer.get("credit_limit"));
        ctx.ok(Web.map(
                "customer", Json.shape(customer),
                "ledger", ledger,
                "entries", ledger,
                "closingBalance", Money.money(running),
                "creditLimit", Money.money(limit),
                "availableCredit", Money.money(limit.subtract(running)),
                "overdueAmount", Money.money(overdueTotal),
                "note", "A credit sale increases the customer balance; a receipt reduces it. Payment mode does not change the credit balance until a receipt is recorded."));
    }

    private static void statement(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("customers.read");
        String month = ctx.q("month");
        if (month == null || !month.matches("\\d{4}-\\d{2}")) throw ApiException.unprocessable("month (YYYY-MM) is required");
        Map<String, Object> customer = Db.one("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", ctx.q("customerId"), auth.tenantId());
        if (customer == null) throw ApiException.notFound("Customer not found");
        String fromIso = Clock.istDayStart(month + "-01");
        String toIso = Clock.istDayStart(Clock.addDays(month + "-28", 4).substring(0, 8) + "01");
        BigDecimal opening = Money.d(customer.get("opening_balance"));
        for (Map<String, Object> r : Db.all("SELECT type, amount FROM credit_entries WHERE customer_id = ? AND status = 'POSTED' AND occurred_at < ?", customer.get("id"), fromIso)) {
            BigDecimal amt = Money.d(r.get("amount"));
            opening = "PAYMENT".equals(r.get("type")) ? opening.subtract(amt.abs()) : opening.add("CREDIT_SALE".equals(r.get("type")) ? amt.abs() : amt);
        }
        List<Map<String, Object>> rows = Db.all(
                """
                SELECT ce.*, st.name AS station_name, p.name AS product_name
                  FROM credit_entries ce
                  LEFT JOIN stations st ON st.id = ce.station_id
                  LEFT JOIN fuel_products p ON p.id = ce.product_id
                 WHERE ce.customer_id = ? AND ce.status = 'POSTED' AND ce.occurred_at >= ? AND ce.occurred_at < ?
                 ORDER BY ce.occurred_at ASC, ce.created_at ASC
                """, customer.get("id"), fromIso, toIso);
        BigDecimal running = opening;
        BigDecimal totalSales = BigDecimal.ZERO;
        BigDecimal totalPayments = BigDecimal.ZERO;
        List<Map<String, Object>> lines = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String type = Db.str(row, "type");
            BigDecimal amt = Money.d(row.get("amount"));
            BigDecimal abs = amt.abs();
            if ("CREDIT_SALE".equals(type)) { running = running.add(abs); totalSales = totalSales.add(abs); }
            else if ("PAYMENT".equals(type)) { running = running.subtract(abs); totalPayments = totalPayments.add(abs); }
            else { running = running.add(amt); }
            Map<String, Object> line = Json.shape(row);
            line.put("debit", "CREDIT_SALE".equals(type) ? Money.money(abs) : "0.00");
            line.put("credit", "PAYMENT".equals(type) ? Money.money(abs) : "0.00");
            line.put("runningBalance", Money.money(running));
            lines.add(line);
        }
        Map<String, Object> tenant = Db.one("SELECT name, legal_name, gstin, address FROM tenants WHERE id = ?", auth.tenantId());
        List<Map<String, Object>> vehicles = Json.shapeAll(Db.all("SELECT * FROM customer_vehicles WHERE customer_id = ? AND is_active = 1 ORDER BY vehicle_number", customer.get("id")));
        ctx.ok(Web.map(
                "tenant", tenant == null ? null : Json.shape(tenant),
                "customer", Json.shape(customer),
                "vehicles", vehicles,
                "month", month,
                "openingBalance", Money.money(opening),
                "closingBalance", Money.money(running),
                "totalSales", Money.money(totalSales),
                "totalPayments", Money.money(totalPayments),
                "lines", lines,
                "generatedAt", Clock.nowIso()));
    }

    private static void creditSale(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("sales.write");
        Map<String, Object> station = auth.station(requiredBody(ctx, "stationId"));
        Map<String, Object> customer = Db.one("SELECT * FROM customers WHERE id = ? AND tenant_id = ?", requiredBody(ctx, "customerId"), auth.tenantId());
        if (customer == null) throw ApiException.notFound("Customer not found");
        String rateStr = ctx.str("ratePerLitre");
        if ((rateStr == null || rateStr.isBlank()) && ctx.str("productId") != null && !ctx.str("productId").isBlank()) {
            Map<String, Object> price = Domain.priceAt(auth.tenantId(), ctx.str("productId"), Db.str(station, "id"));
            if (price != null) rateStr = Db.str(price, "rate_per_litre");
        }
        final String resolvedRate = rateStr;
        BigDecimal amount = ctx.str("amount") != null && !ctx.str("amount").isBlank()
                ? Money.d(ctx.str("amount"))
                : (ctx.str("quantityLitres") != null && resolvedRate != null ? Money.d(ctx.str("quantityLitres")).multiply(Money.d(resolvedRate)) : BigDecimal.ZERO);
        if (amount.signum() <= 0) throw ApiException.unprocessable("Amount do, ya litres + rate do — dono me se ek zaroori hai");
        BigDecimal balance = Money.d(customer.get("balance"));
        BigDecimal limit = Money.d(customer.get("credit_limit"));
        if (limit.signum() > 0 && balance.add(amount).compareTo(limit) > 0) {
            throw ApiException.unprocessable("Credit limit exceeded: outstanding " + Money.money(balance) + ", limit " + Money.money(limit));
        }
        String id = Clock.newId("cre");
        String now = Clock.nowIso();
        long seq = Db.count("SELECT COUNT(*) FROM credit_entries WHERE station_id = ? AND type = 'CREDIT_SALE'", station.get("id")) + 1;
        String slip = ctx.str("slipNumber") == null || ctx.str("slipNumber").isBlank()
                ? station.get("code") + "-" + Clock.todayIst().replace("-", "") + "-" + String.format("%03d", seq)
                : ctx.str("slipNumber");
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
                    resolvedRate == null ? null : Money.rate(resolvedRate),
                    ctx.str("reference"), now, ctx.str("dueDate"), ctx.str("note"), auth.userId, now);
            Db.exec("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?", Money.money(balance.add(amount)), now, customer.get("id"));
            return id;
        });
        Auth.audit(auth, "CREDIT_SALE_RECORDED", "CreditEntry", id, Db.str(station, "id"), customer.get("name") + ": " + Money.money(amount));
        ctx.created(Web.map("id", id, "customerId", customer.get("id"), "slipNumber", slip, "amount", Money.money(amount), "newBalance", Money.money(balance.add(amount))));
    }

    private static void supplierLedger(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("suppliers.read");
        Map<String, Object> supplier = Db.one("SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?", required(ctx, "supplierId"), auth.tenantId());
        if (supplier == null) throw ApiException.notFound("Supplier not found");
        List<Map<String, Object>> events = new ArrayList<>();
        for (Map<String, Object> d : Db.all(
                "SELECT d.*, p.name AS product_name FROM deliveries d JOIN fuel_products p ON p.id = d.product_id WHERE d.supplier_id = ? AND d.status = 'RECEIVED'",
                supplier.get("id"))) {
            events.add(Web.map(
                    "id", d.get("id"),
                    "date", d.get("received_at") != null ? d.get("received_at") : (d.get("invoice_date") + "T00:00:00.000Z"),
                    "type", "PURCHASE",
                    "description", d.get("product_name") + " · " + d.get("quantity_litres") + " L · Inv " + d.get("invoice_number"),
                    "reference", d.get("invoice_number"),
                    "debit", Money.money(d.get("total_amount")),
                    "credit", "0.00"));
        }
        for (Map<String, Object> pay : Db.all(
                "SELECT * FROM payments WHERE supplier_id = ? AND direction = 'PAYOUT' AND status != 'REVERSED'",
                supplier.get("id"))) {
            events.add(Web.map(
                    "id", pay.get("id"),
                    "date", pay.get("occurred_at"),
                    "type", "PAYMENT",
                    "description", pay.get("mode") + (pay.get("reference") != null ? " · " + pay.get("reference") : ""),
                    "reference", pay.get("reference"),
                    "debit", "0.00",
                    "credit", Money.money(pay.get("amount"))));
        }
        events.sort((a, b) -> String.valueOf(a.get("date")).compareTo(String.valueOf(b.get("date"))));
        BigDecimal running = Money.d(supplier.get("opening_balance"));
        List<Map<String, Object>> ledger = new ArrayList<>();
        for (Map<String, Object> ev : events) {
            running = running.add(Money.d(ev.get("debit"))).subtract(Money.d(ev.get("credit")));
            Map<String, Object> item = new LinkedHashMap<>(ev);
            item.put("runningBalance", Money.money(running));
            ledger.add(item);
        }
        ctx.ok(Web.map(
                "supplier", Json.shape(supplier),
                "ledger", ledger,
                "entries", ledger,
                "openingBalance", Money.money(supplier.get("opening_balance")),
                "closingBalance", Money.money(running),
                "note", "Purchases enter the payable ledger when a delivery is marked received."));
    }

    private static void payments(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("payments.read");
        int page = Domain.pageOf(ctx);
        int size = Domain.pageSize(ctx);
        String where = "p.tenant_id = ?";
        List<Object> params = new ArrayList<>(List.of(auth.tenantId()));
        if (ctx.q("stationId") != null && !ctx.q("stationId").isBlank()) {
            auth.station(ctx.q("stationId"));
            where += " AND p.station_id = ?";
            params.add(ctx.q("stationId"));
        }
        if (ctx.q("direction") != null && !ctx.q("direction").isBlank()) {
            where += " AND p.direction = ?";
            params.add(ctx.q("direction"));
        }
        if (ctx.q("status") != null && !ctx.q("status").isBlank()) {
            where += " AND p.status = ?";
            params.add(ctx.q("status"));
        }
        long total = Db.count("SELECT COUNT(*) AS count FROM payments p WHERE " + where, params.toArray());
        params.add(size);
        params.add((page - 1) * size);
        ctx.ok(Json.shapeAll(Db.all(
                """
                SELECT p.*, c.name AS customer_name, s.name AS supplier_name, st.name AS station_name
                  FROM payments p
                  LEFT JOIN customers c ON c.id = p.customer_id
                  LEFT JOIN suppliers s ON s.id = p.supplier_id
                  LEFT JOIN stations st ON st.id = p.station_id
                 WHERE %s ORDER BY p.occurred_at DESC, p.created_at DESC LIMIT ? OFFSET ?
                """.formatted(where), params.toArray())), Domain.page(total, page, size));
    }

    private static void createPayment(Web.Ctx ctx) {
        Auth auth = ctx.requireAuth();
        auth.require("payments.write");
        String id = Clock.newId("pay");
        String now = ctx.str("occurredAt") == null || ctx.str("occurredAt").isBlank() ? Clock.nowIso() : ctx.str("occurredAt");
        String partyType = ctx.str("partyType") == null ? "CUSTOMER" : ctx.str("partyType");
        String direction = ctx.str("direction") == null ? ("SUPPLIER".equals(partyType) ? "PAYOUT" : "RECEIPT") : ctx.str("direction");
        String customerId = ctx.str("customerId") != null ? ctx.str("customerId") : ("CUSTOMER".equals(partyType) ? ctx.str("partyId") : null);
        String supplierId = ctx.str("supplierId") != null ? ctx.str("supplierId") : ("SUPPLIER".equals(partyType) ? ctx.str("partyId") : null);
        String stationId = requiredBody(ctx, "stationId");
        auth.station(stationId);
        String amt = Money.money(requiredBody(ctx, "amount"));
        String mode = ctx.str("mode") == null ? "CASH" : ctx.str("mode");
        String status = "CASH".equals(mode) ? "SETTLED" : "POSTED";
        String notes = ctx.str("notes") != null ? ctx.str("notes") : ctx.str("note");
        Db.tx(() -> {
            Db.exec(
                    """
                    INSERT INTO payments (id, tenant_id, station_id, direction, party_type, customer_id, supplier_id, amount, mode, status, settled_at, reference, notes, occurred_at, created_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    id, auth.tenantId(), stationId, direction, partyType, customerId, supplierId,
                    amt, mode, status, "SETTLED".equals(status) ? now : null,
                    ctx.str("reference"), notes, now, auth.userId, Clock.nowIso());
            if ("CUSTOMER".equals(partyType) && customerId != null && "RECEIPT".equals(direction)) {
                Map<String, Object> customer = Db.one("SELECT balance FROM customers WHERE id = ?", customerId);
                if (customer != null) {
                    Db.exec("UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?",
                            Money.money(Money.d(customer.get("balance")).subtract(Money.d(amt))), Clock.nowIso(), customerId);
                    Db.exec(
                            "INSERT INTO credit_entries (id, tenant_id, station_id, customer_id, type, amount, payment_id, reference, occurred_at, note, status, created_by, created_at) VALUES (?, ?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, 'POSTED', ?, ?)",
                            Clock.newId("cre"), auth.tenantId(), stationId, customerId, amt, id, ctx.str("reference"), now, notes, auth.userId, Clock.nowIso());
                }
            }
            return null;
        });
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
