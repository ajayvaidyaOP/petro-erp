package in.petrolflow;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Production guard for demo/seeded accounts (audit finding A4).
 *
 * <p>The demo dataset is defined by {@code backend/db/mysql/seed.sql} and by the {@code users.is_demo}
 * column that the rest of the application already uses (for example {@code /auth/demo-accounts}).
 * This class only ever <em>reads</em> those rows: when demo accounts are seen in a production
 * database the startup is aborted with an actionable message. Accounts are never deleted,
 * renamed, disabled or otherwise modified automatically.
 */
public final class DemoGuard {
    /**
     * Accounts shipped by {@code backend/db/mysql/seed.sql}. Kept as a static list because the seed
     * file is not required at runtime, and because an operator may clear the is_demo flag without
     * realising the account is still a known demo login.
     */
    public static final List<String> SEEDED_DEMO_EMAILS = List.of(
            "superadmin@petroflow.dev",
            "owner@sunrisefuels.in",
            "manager@sunrisefuels.in",
            "attendant@sunrisefuels.in");

    /** A detected demo account. Deliberately carries no password hash, token or other secret. */
    public record Finding(String userId, String email, String reason) {}

    private static final Pattern USER_INSERT = Pattern.compile(
            "(?i)INSERT\\s+INTO\\s+`?users`?\\s*\\([^)]*\\)\\s*VALUES\\s*\\(([^;]*)");
    private static final Pattern QUOTED = Pattern.compile("'([^']*)'");

    private DemoGuard() {}

    /**
     * Reads the demo account emails straight out of {@code backend/db/mysql/seed.sql} so the guard
     * always matches the demo data that actually ships with the application. Returns an empty set
     * when the seed file is missing.
     */
    public static Set<String> seededEmails(Path seedFile) {
        Set<String> emails = new TreeSet<>();
        if (seedFile == null || !Files.isRegularFile(seedFile)) return emails;
        try {
            for (String line : Files.readAllLines(seedFile)) {
                Matcher statement = USER_INSERT.matcher(line);
                if (!statement.find()) continue;
                Matcher value = QUOTED.matcher(statement.group(1));
                while (value.find()) {
                    String candidate = value.group(1).trim().toLowerCase(Locale.ROOT);
                    if (candidate.contains("@") && !candidate.contains(" ")) {
                        emails.add(candidate);
                        break;
                    }
                }
            }
        } catch (IOException | RuntimeException ignored) {
            return emails;
        }
        return emails;
    }

    /**
     * Pure detection logic so it can be unit-tested without a database.
     *
     * @param users rows containing at least {@code id}, {@code email} and {@code is_demo}
     */
    public static List<Finding> scan(Collection<Map<String, Object>> users) {
        return scan(users, SEEDED_DEMO_EMAILS);
    }

    /** Detection with an explicit list of seeded demo emails (normally read from seed.sql). */
    public static List<Finding> scan(Collection<Map<String, Object>> users, Collection<String> seededEmails) {
        List<Finding> findings = new ArrayList<>();
        if (users == null) return findings;
        Set<String> seededSet = new LinkedHashSet<>();
        if (seededEmails != null) {
            for (String email : seededEmails) {
                if (email != null && !email.isBlank()) seededSet.add(email.trim().toLowerCase(Locale.ROOT));
            }
        }
        for (Map<String, Object> row : users) {
            if (row == null) continue;
            String email = Db.str(row, "email");
            String normalized = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
            boolean flagged = Db.num(row, "is_demo") == 1;
            boolean seeded = seededSet.contains(normalized);
            if (!flagged && !seeded) continue;
            String reason;
            if (flagged && seeded) {
                reason = "is_demo=1 and seeded demo email";
            } else if (flagged) {
                reason = "is_demo=1";
            } else {
                reason = "seeded demo email from backend/db/mysql/seed.sql";
            }
            findings.add(new Finding(Db.str(row, "id"), normalized, reason));
        }
        return findings;
    }

    /** Reads candidate accounts from the live database. Never selects password hashes. */
    public static List<Finding> detectInDatabase() {
        return scan(Db.all("SELECT id, email, is_demo FROM users"));
    }

    /** Reads candidate accounts and compares them with the demo accounts declared in {@code seed.sql}. */
    public static List<Finding> detectInDatabase(Collection<String> seededEmails) {
        return scan(Db.all("SELECT id, email, is_demo FROM users"), seededEmails);
    }

    public static boolean usersTableExists() {
        long tables = Db.count(
                "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'");
        return tables > 0;
    }

    /**
     * Aborts startup when a production database still contains demo accounts.
     *
     * <p>Non-production environments are untouched. A database that has no {@code users} table yet
     * (first boot) simply has nothing to detect.
     *
     * @throws IllegalStateException with an operator-facing message when demo accounts are present
     */
    public static void enforceProductionStartup(Config config) {
        if (config == null || !config.production) return;
        if (!usersTableExists()) {
            System.out.println("Production demo guard: users table not created yet — nothing to verify.");
            return;
        }
        // Derive the demo logins from the seed file that ships with this build; if it is not present
        // (for example a jar-only deployment) fall back to the known list baked into this class.
        Set<String> seeded = seededEmails(config.mysqlDir().resolve("seed.sql"));
        if (seeded.isEmpty()) seeded = new TreeSet<>(SEEDED_DEMO_EMAILS);
        List<Finding> findings = detectInDatabase(seeded);
        if (!findings.isEmpty()) {
            throw new IllegalStateException(describe(findings));
        }
        System.out.println("Production demo guard: no demo accounts detected.");
    }

    /** Builds the operator-facing failure message. Contains emails only — no credentials. */
    public static String describe(List<Finding> findings) {
        Set<String> emails = new LinkedHashSet<>();
        Set<String> reasons = new LinkedHashSet<>();
        for (Finding finding : findings) {
            if (finding.email() != null && !finding.email().isBlank()) emails.add(finding.email());
            if (finding.reason() != null) reasons.add(finding.reason());
        }
        StringBuilder message = new StringBuilder();
        message.append("Production startup aborted: ")
                .append(findings.size())
                .append(" demo/seeded account(s) were found in this database (")
                .append(String.join(", ", emails))
                .append("; detected via ")
                .append(String.join(" / ", reasons))
                .append(").\n")
                .append("PetroFlow did not delete, rename, disable or modify any account — the database is untouched.\n")
                .append("To continue, do this on a database copy or during a maintenance window:\n")
                .append("  1. Create the real dealer logins. On a clean database use the one-time command\n")
                .append("     `gradlew run --args=\"--bootstrap-owner\"`; on this existing database rename the\n")
                .append("     demo logins to the real operator addresses (UPDATE users SET email = ..., is_demo = 0).\n")
                .append("  2. Remove the remaining demo rows yourself, or set is_demo=0 for accounts that are\n")
                .append("     genuinely in use. PetroFlow will not do this for you.\n")
                .append("  3. Restart the API. It starts once no demo/seeded account remains.\n")
                .append("Keep SEED_DEMO_DATA=false and ENABLE_DEMO_TOOLS=false in production.");
        return message.toString();
    }
}
