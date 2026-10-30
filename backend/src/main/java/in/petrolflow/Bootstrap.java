package in.petrolflow;

import java.io.BufferedReader;
import java.io.Console;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * One-time creation of the first legitimate owner (or platform administrator) for an installation
 * that was never seeded with demo data (audit findings D1/D2).
 *
 * <p>This is an offline operator command — it is <strong>not</strong> an HTTP endpoint, so no
 * unauthenticated registration route exists. It refuses to do anything once an owner or platform
 * administrator exists, once it has already completed, or when any of the rows it would create is
 * already taken.
 *
 * <p>Concurrency: the whole check-and-create sequence runs inside one transaction held under a MySQL
 * named advisory lock, so two bootstraps started at the same second (or from two API hosts) cannot
 * both create an owner.
 *
 * <p>The password is only ever read from the operator's terminal (never from argv, which is visible
 * in process lists and shell history), hashed with the existing PBKDF2 implementation, and never
 * logged or echoed.
 */
public final class Bootstrap {
    /** Written once, so a second bootstrap is refused even if the owner row is later renamed. */
    public static final String MARKER_KEY = "security.bootstrap.completed";
    /** Server-side advisory lock name; identical across processes and hosts. */
    public static final String LOCK_NAME = "petroflow.bootstrap.first-owner";
    private static final int LOCK_TIMEOUT_SECONDS = 15;

    public static final String ROLE_OWNER = "OWNER";
    public static final String ROLE_SUPER_ADMIN = "SUPER_ADMIN";
    private static final List<String> ALLOWED_ROLES = List.of(ROLE_OWNER, ROLE_SUPER_ADMIN);

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final Pattern SLUG = Pattern.compile("^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$");
    private static final Pattern STATION_CODE = Pattern.compile("^[A-Z0-9][A-Z0-9-]{0,19}$");

    private Bootstrap() {}

    /** Operator-supplied values. The password is deliberately not part of this record. */
    public record Request(
            String role,
            String email,
            String ownerName,
            String tenantName,
            String tenantSlug,
            String stationName,
            String stationCode,
            String city,
            String state) {

        public static Request owner(String email, String ownerName, String tenantName, String tenantSlug) {
            return new Request(ROLE_OWNER, email, ownerName, tenantName, tenantSlug, null, null, null, null);
        }

        public static Request superAdmin(String email, String name) {
            return new Request(ROLE_SUPER_ADMIN, email, name, null, null, null, null, null, null);
        }
    }

    /** What was created. Contains no secret material. */
    public record Result(String userId, String tenantId, String stationId, String email, String role, String tenantSlug) {}

    /** Operator-facing validation or refusal; carries a message safe to print. */
    public static final class BootstrapException extends RuntimeException {
        public BootstrapException(String message) {
            super(message);
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Validation (pure — no database access, unit-testable)
    // ---------------------------------------------------------------------------------------------

    /** Validates and normalises the request, or throws {@link BootstrapException}. */
    public static Request validate(Request request) {
        if (request == null) throw new BootstrapException("No bootstrap details were supplied.");
        String role = blank(request.role()) ? ROLE_OWNER : request.role().trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_ROLES.contains(role)) {
            throw new BootstrapException("Role must be OWNER or SUPER_ADMIN (got \"" + request.role() + "\").");
        }
        String email = blank(request.email()) ? "" : request.email().trim().toLowerCase(Locale.ROOT);
        if (email.isEmpty()) throw new BootstrapException("An email address is required.");
        if (email.length() > 255) throw new BootstrapException("Email address must be at most 255 characters.");
        if (!EMAIL.matcher(email).matches()) {
            throw new BootstrapException("That does not look like an email address: " + email);
        }
        String ownerName = request.ownerName() == null ? "" : request.ownerName().trim();
        if (ownerName.isEmpty()) throw new BootstrapException("A name for the account is required.");
        if (ownerName.length() > 255) throw new BootstrapException("Name must be at most 255 characters.");

        if (ROLE_SUPER_ADMIN.equals(role)) {
            return new Request(role, email, ownerName, null, null, null, null, null, null);
        }

        String tenantName = request.tenantName() == null ? "" : request.tenantName().trim();
        if (tenantName.isEmpty()) throw new BootstrapException("A company (tenant) name is required for an OWNER account.");
        if (tenantName.length() > 255) throw new BootstrapException("Company name must be at most 255 characters.");
        String slug = blank(request.tenantSlug()) ? slugify(tenantName) : request.tenantSlug().trim().toLowerCase(Locale.ROOT);
        if (!SLUG.matcher(slug).matches()) {
            throw new BootstrapException(
                    "Company slug must be 2-40 characters of a-z, 0-9 and '-', starting and ending with a letter or digit (got \"" + slug + "\").");
        }
        String stationName = request.stationName() == null ? "" : request.stationName().trim();
        String stationCode = blank(request.stationCode())
                ? (stationName.isEmpty() ? "" : slug.substring(0, Math.min(6, slug.length())).toUpperCase(Locale.ROOT) + "-01")
                : request.stationCode().trim().toUpperCase(Locale.ROOT);
        if (!stationName.isEmpty() && !STATION_CODE.matcher(stationCode).matches()) {
            throw new BootstrapException("Station code must be 1-20 characters of A-Z, 0-9 and '-' (got \"" + stationCode + "\").");
        }
        if (stationName.isEmpty() && !stationCode.isEmpty()) {
            throw new BootstrapException("A station code was given without a station name.");
        }
        return new Request(role, email, ownerName, tenantName, slug,
                stationName.isEmpty() ? null : stationName,
                stationName.isEmpty() ? null : stationCode,
                blank(request.city()) ? null : request.city().trim(),
                blank(request.state()) ? null : request.state().trim());
    }

    /** Derives a URL-safe slug from a company name. */
    public static String slugify(String value) {
        String slug = (value == null ? "" : value)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        if (slug.length() > 40) slug = slug.substring(0, 40).replaceAll("-+$", "");
        return slug;
    }

    /**
     * Password policy: the existing application rule plus a refusal to reuse the published demo
     * password. Never returns or logs the password.
     */
    public static void validatePassword(Config config, String password) {
        if (password == null || password.isEmpty()) throw new BootstrapException("A password is required.");
        try {
            Passwords.assertStrength(password);
        } catch (ApiException weak) {
            throw new BootstrapException(weak.getMessage());
        }
        if (config != null && password.equals(config.demoPassword)) {
            throw new BootstrapException(
                    "That is the published demo password. Choose a password that is not used anywhere in the documentation.");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Creation (transactional, advisory-locked)
    // ---------------------------------------------------------------------------------------------

    /**
     * Creates the first owner. Throws {@link BootstrapException} when the operation is refused; nothing
     * is written in that case.
     */
    public static Result createFirstOwner(Config config, Request request, String password) {
        Request req = validate(request);
        validatePassword(config, password);
        String passwordHash = Passwords.hash(password); // PBKDF2, same implementation as normal sign-up/login
        String now = Clock.nowIso();

        return Db.withConnection(() -> {
            if (!Db.acquireLock(LOCK_NAME, LOCK_TIMEOUT_SECONDS)) {
                throw new BootstrapException("Another bootstrap is already running. Wait for it to finish and check the result.");
            }
            try {
                return Db.tx(() -> {
                    refuseIfAlreadyBootstrapped();
                    if (Db.one("SELECT id FROM users WHERE email = ?", req.email()) != null) {
                        throw new BootstrapException(
                                "An account with the email " + req.email() + " already exists. Bootstrap never modifies existing accounts.");
                    }
                    String tenantId = null;
                    String stationId = null;
                    if (ROLE_OWNER.equals(req.role())) {
                        if (Db.one("SELECT id FROM tenants WHERE slug = ?", req.tenantSlug()) != null) {
                            throw new BootstrapException("A company with the slug \"" + req.tenantSlug() + "\" already exists.");
                        }
                        tenantId = Clock.newId("tnt");
                        Db.exec(
                                "INSERT INTO tenants (id, name, slug, contact_email, city, state, status, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)",
                                tenantId, req.tenantName(), req.tenantSlug(), req.email(),
                                req.city() == null ? "" : req.city(), req.state() == null ? "" : req.state(), now, now);
                        Map<String, Object> plan = Db.one(
                                "SELECT id FROM subscription_plans WHERE is_active = 1 ORDER BY CAST(monthly_price AS DECIMAL(18,2)) ASC LIMIT 1");
                        if (plan != null) {
                            Db.exec(
                                    "INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, created_at, updated_at) VALUES (?, ?, ?, 'TRIALING', ?, ?, ?)",
                                    Clock.newId("sub"), tenantId, plan.get("id"), now, now, now);
                        }
                        if (req.stationName() != null) {
                            stationId = Clock.newId("stn");
                            Db.exec(
                                    "INSERT INTO stations (id, tenant_id, code, name, city, state, timezone, status, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'Asia/Kolkata', 'ACTIVE', 0, ?, ?)",
                                    stationId, tenantId, req.stationCode(), req.stationName(),
                                    req.city() == null ? "" : req.city(), req.state() == null ? "" : req.state(), now, now);
                        }
                    }

                    String userId = Clock.newId("usr");
                    Db.exec(
                            """
                            INSERT INTO users (id, tenant_id, email, name, password_hash, role_key, status,
                                               must_change_password, is_demo, granted_permissions, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 0, '[]', ?, ?)
                            """,
                            userId, tenantId, req.email(), req.ownerName(), passwordHash, req.role(), now, now);
                    if (stationId != null) {
                        Db.exec(
                                "INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, '[]', ?)",
                                Clock.newId("usa"), userId, stationId, now);
                    }
                    Db.exec(
                            "INSERT INTO app_settings (id, tenant_id, station_id, `key`, value, updated_at) VALUES (?, '', '', ?, ?, ?)",
                            Clock.newId("stg"), MARKER_KEY, req.role() + " " + now, now);
                    return new Result(userId, tenantId, stationId, req.email(), req.role(), req.tenantSlug());
                });
            } finally {
                Db.releaseLock(LOCK_NAME);
            }
        });
    }

    /**
     * Refusals that apply before any row is written. Exposed for tests.
     *
     * @throws BootstrapException when the database already has an owner/platform administrator, or
     *                            when a previous bootstrap completed
     */
    public static void refuseIfAlreadyBootstrapped() {
        long privileged = Db.count("SELECT COUNT(*) AS count FROM users WHERE role_key IN ('OWNER','SUPER_ADMIN')");
        if (privileged > 0) {
            throw new BootstrapException(
                    "This database already has " + privileged + " owner/platform-administrator account(s). "
                            + "Bootstrap only ever creates the first one; it never resets or duplicates an existing login.");
        }
        long markers = Db.count("SELECT COUNT(*) AS count FROM app_settings WHERE `key` = ?", MARKER_KEY);
        if (markers > 0) {
            throw new BootstrapException(
                    "Bootstrap already completed on this database (marker " + MARKER_KEY + "). "
                            + "It is a one-time command and stays disabled after success.");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Operator CLI
    // ---------------------------------------------------------------------------------------------

    /** Parses {@code --key=value} style flags, ignoring flags owned by {@link Main}. */
    public static Map<String, String> parseArgs(String[] args) {
        Map<String, String> values = new LinkedHashMap<>();
        if (args == null) return values;
        for (String arg : args) {
            if (arg == null || !arg.startsWith("--") || arg.indexOf('=') < 0) continue;
            int eq = arg.indexOf('=');
            values.put(arg.substring(2, eq).trim().toLowerCase(Locale.ROOT), arg.substring(eq + 1));
        }
        return values;
    }

    /**
     * Interactive entry point. Values may be pre-supplied with {@code --email=}, {@code --name=},
     * {@code --tenant=}, {@code --slug=}, {@code --station=}, {@code --station-code=}, {@code --city=},
     * {@code --state=}, {@code --role=}; anything missing is asked on the terminal. The password is
     * always asked for (twice) and is never accepted from the command line.
     */
    public static Result runCli(Config config, String[] args) {
        Map<String, String> options = parseArgs(args);
        Prompter prompter = new Prompter();
        String role = options.getOrDefault("role", ROLE_OWNER);
        String email = options.get("email");
        String name = options.get("name");
        String tenant = options.get("tenant");
        String slug = options.get("slug");
        String station = options.get("station");
        String stationCode = options.get("station-code");
        String city = options.get("city");
        String state = options.get("state");

        System.out.println();
        System.out.println("PetroFlow — first owner setup");
        System.out.println("This runs once, on an empty database, and is refused afterwards.");
        System.out.println("Nothing is written to the database if any check fails.");
        System.out.println();
        if (options.containsKey("role")) {
            System.out.println("Account type: " + role.trim().toUpperCase(Locale.ROOT));
        } else {
            String answer = prompter.ask("Account type — OWNER for a pump owner, SUPER_ADMIN for platform staff [OWNER]: ");
            role = blank(answer) ? ROLE_OWNER : answer;
        }
        if (blank(email)) email = prompter.ask("Email address for this login: ");
        if (blank(name)) name = prompter.ask("Full name of the person: ");
        boolean superAdmin = ROLE_SUPER_ADMIN.equals(role.trim().toUpperCase(Locale.ROOT));
        if (!superAdmin) {
            if (blank(tenant)) tenant = prompter.ask("Pump company (business) name: ");
            if (blank(slug)) slug = prompter.ask("Short company code for URLs, a-z/0-9/dash (blank = derive from name): ");
            if (blank(station)) station = prompter.ask("First pump/station name (blank = create it later in the app): ");
            if (!blank(station) && blank(stationCode)) stationCode = prompter.ask("Station code, e.g. SUN-01 (blank = derive): ");
            if (blank(city)) city = prompter.ask("City (optional): ");
            if (blank(state)) state = prompter.ask("State (optional): ");
        }

        Request request = new Request(role, email, name, tenant, slug, station, stationCode, city, state);
        Request valid = validate(request); // fail before asking for a password
        String password = prompter.askPassword("Password (at least 10 characters, with a letter and a number): ");
        String confirm = prompter.askPassword("Type the password again: ");
        if (!password.equals(confirm)) throw new BootstrapException("The two passwords do not match. Nothing was created.");
        validatePassword(config, password);

        Result result = createFirstOwner(config, valid, password);
        System.out.println();
        System.out.println("First login created.");
        System.out.println("  Email:    " + result.email());
        System.out.println("  Account:  " + result.role());
        if (result.tenantSlug() != null) System.out.println("  Company:  " + valid.tenantName() + " (" + result.tenantSlug() + ")");
        if (result.stationId() != null) System.out.println("  Station:  " + valid.stationName() + " (" + valid.stationCode() + ")");
        System.out.println();
        System.out.println("Sign in with the password you just typed. It is stored only as a hash.");
        System.out.println("This command is now disabled on this database; running it again will be refused.");
        return result;
    }

    /** Console-with-fallback input. Secrets never echo when a terminal is attached. */
    private static final class Prompter {
        private final Console console = System.console();
        private final BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));

        String ask(String label) {
            System.out.print(label);
            System.out.flush();
            if (console != null) {
                String line = console.readLine();
                if (line == null) throw new BootstrapException("No input received. Nothing was created.");
                return line.trim();
            }
            try {
                String line = reader.readLine();
                if (line == null) throw new BootstrapException("No input received. Nothing was created.");
                return line.trim();
            } catch (IOException error) {
                throw new BootstrapException("Could not read input: " + error.getMessage());
            }
        }

        String askPassword(String label) {
            System.out.print(label);
            System.out.flush();
            if (console != null) {
                char[] value = console.readPassword();
                if (value == null) throw new BootstrapException("No password received. Nothing was created.");
                System.out.println();
                String password = new String(value);
                java.util.Arrays.fill(value, '\0');
                return password;
            }
            try {
                String line = reader.readLine();
                System.out.println();
                if (line == null) throw new BootstrapException("No password received. Nothing was created.");
                return line;
            } catch (IOException error) {
                throw new BootstrapException("Could not read the password: " + error.getMessage());
            }
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    /** Human-readable summary used by the CLI and by tests. Never includes the password. */
    public static String describe(Result result) {
        List<String> parts = new ArrayList<>();
        parts.add(result.role());
        parts.add(result.email());
        if (result.tenantSlug() != null) parts.add("tenant=" + result.tenantSlug());
        if (result.stationId() != null) parts.add("station=" + result.stationId());
        return String.join(" ", parts);
    }
}
