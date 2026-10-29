package in.petrolflow;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class Permissions {
    public static final List<String> ALL = List.of(
            "platform.manage", "platform.audit",
            "stations.read", "stations.write", "products.read", "products.write", "prices.write",
            "tanks.read", "tanks.write", "dispensers.read", "dispensers.write",
            "employees.read", "employees.write",
            "devices.read", "devices.write", "readings.read", "readings.manual",
            "shifts.read", "shifts.open", "shifts.close", "shifts.approve",
            "sales.read", "sales.write", "stock.read", "stock.write",
            "deliveries.read", "deliveries.write",
            "customers.read", "customers.write", "suppliers.read", "suppliers.write",
            "payments.read", "payments.write", "expenses.read", "expenses.write",
            "reconciliation.read", "reconciliation.write", "reports.read",
            "density.read", "density.write", "dayclose.manage",
            "compliance.read", "compliance.write", "lubricants.read", "lubricants.write",
            "attendance.read", "attendance.write", "audit.read",
            "settings.read", "settings.write", "billing.read");

    private static final Set<String> BLOCKED = Set.of("platform.manage", "platform.audit", "employees.write");
    private static final List<String> MANAGER = List.of(
            "stations.read", "products.read", "tanks.read", "dispensers.read",
            "devices.read", "readings.read", "readings.manual",
            "shifts.read", "shifts.open", "shifts.close", "shifts.approve",
            "sales.read", "sales.write", "stock.read", "stock.write",
            "deliveries.read", "deliveries.write", "customers.read", "customers.write",
            "suppliers.read", "payments.read", "payments.write", "expenses.read", "expenses.write",
            "reconciliation.read", "reconciliation.write", "reports.read",
            "density.read", "density.write", "dayclose.manage",
            "compliance.read", "lubricants.read", "lubricants.write",
            "attendance.read", "attendance.write");

    private Permissions() {}

    public static List<String> forRole(String role) {
        return switch (role == null ? "" : role) {
            case "OWNER" -> ALL.stream().filter(p -> !BLOCKED.contains(p) || "employees.write".equals(p)).filter(p -> !p.startsWith("platform.")).toList();
            case "MANAGER" -> MANAGER;
            case "SUPER_ADMIN" -> List.of("platform.manage", "platform.audit", "settings.read");
            default -> List.of();
        };
    }

    public static List<String> sanitize(Object raw) {
        Set<String> seen = new LinkedHashSet<>();
        for (String value : Auth.grants(raw)) {
            if (ALL.contains(value) && !BLOCKED.contains(value)) seen.add(value);
        }
        return new ArrayList<>(seen);
    }
}
