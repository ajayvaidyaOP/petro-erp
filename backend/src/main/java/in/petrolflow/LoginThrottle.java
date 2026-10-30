package in.petrolflow;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Failed sign-in throttling (audit finding A5).
 *
 * <p>Two independent buckets are enforced for every login attempt:
 * <ul>
 *   <li>the client IP address, so one host cannot spray many accounts;</li>
 *   <li>the normalized account identifier, so one account cannot be sprayed from many hosts.</li>
 * </ul>
 *
 * <p>Attempts are stored in MySQL ({@code login_throttle_attempts}) rather than in JVM memory so the
 * limits still hold when the API is restarted or when more than one API process shares the database.
 *
 * <p>Each call <em>reserves</em> a row before counting, so a burst of concurrent requests is counted
 * together and cannot slip past the limit. When a request is rejected the reservation is released
 * again: blocked attempts therefore never extend a lockout, which keeps the throttle from becoming a
 * denial-of-service tool against a legitimate operator. A successful sign-in clears only that
 * account's own rows.
 *
 * <p><strong>Isolation and deadlocks (audit finding D3).</strong> The API runs MySQL sessions at
 * {@code SERIALIZABLE}, where a plain {@code SELECT} takes shared next-key locks over the scanned
 * index range. Two simultaneous <em>INSERT + COUNT</em> sequences over overlapping ranges (same IP,
 * e.g. a burst from one host) can therefore deadlock through insert-intention vs. gap locks, which
 * would surface as a 500 instead of a clean 429.
 *
 * <p>The sequence is deliberately kept in autocommit: each reservation is committed before it is
 * counted, and that commit-before-count ordering is what makes the limit correct. Wrapping the
 * insert and the count in one transaction would hide every in-flight reservation from the other
 * requests (uncommitted rows are invisible), so N concurrent attempts could all see "0 attempts"
 * and all be admitted — that would silently disable the limiter. Instead the reservation+count
 * critical section is serialised across processes with a MySQL named advisory lock
 * ({@link #LOCK_NAME}), which leaves the isolation level, the autocommit ordering and the stored
 * data completely unchanged. Because no two throttle sequences interleave, the gap-lock deadlock
 * cannot form. If the lock cannot be acquired the request fails closed (503) rather than skipping
 * the limit.
 */
public final class LoginThrottle {
    public static final String SCOPE_IP = "IP";
    public static final String SCOPE_ACCOUNT = "ACCOUNT";
    /** Single message used for every failed credential / account-state outcome. */
    public static final String GENERIC_AUTH_MESSAGE = "Invalid email or password";
    public static final String THROTTLED_MESSAGE = "Too many sign-in attempts. Please try again later.";

    /** Server-side advisory lock that serialises the reserve+count critical section. */
    public static final String LOCK_NAME = "petroflow.login_throttle";
    /** How long a request waits for that lock before failing closed. */
    public static final int LOCK_TIMEOUT_SECONDS = 5;

    private static final long PRUNE_EVERY_N_ATTEMPTS = 200L;
    private static final int PRUNE_RETENTION_SECONDS = 172_800; // 48h, >= 2x the maximum window

    private static final AtomicLong ATTEMPT_COUNTER = new AtomicLong();

    private LoginThrottle() {}

    /**
     * Outcome of the pre-authentication check.
     *
     * <p>{@code reservationId} identifies the attempt row created for this request. It is released
     * again when the request is rejected (so a blocked attacker never extends a lockout) and when the
     * sign-in succeeds (so an operator's own successful logins do not count against their IP).
     */
    public record Decision(boolean allowed, String limitedScope, long retryAfterSeconds, String reservationId) {
        public static Decision permit(String reservationId) {
            return new Decision(true, null, 0L, reservationId);
        }

        public static Decision blocked(String scope, long retryAfterSeconds, String reservationId) {
            return new Decision(false, scope, Math.max(1L, retryAfterSeconds), reservationId);
        }
    }

    /** Storage abstraction so the policy can be unit-tested without MySQL. */
    public interface Store {
        /** Reserves one attempt row and returns its identifier. */
        String record(String ipKey, String accountKey, String attemptedAtIso);

        /** Removes a reservation that ended up being rejected by the throttle itself. */
        void release(String id);

        long countByIp(String ipKey, String sinceIso);

        long countByAccount(String accountKey, String sinceIso);

        /** Clears one account's own attempts. Other accounts and other IPs are never touched. */
        long clearAccount(String accountKey);

        String oldestByIp(String ipKey, String sinceIso);

        String oldestByAccount(String accountKey, String sinceIso);

        int pruneBefore(String beforeIso);
    }

    public static String normalizeAccount(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * The value an account bucket is keyed on (audit finding D5).
     *
     * <p>{@code users.email} uses the table collation {@code utf8mb4_unicode_ci}, which is
     * case-insensitive <em>and</em> accent-insensitive. MySQL therefore treats {@code owner@x} and
     * {@code ownér@x} as the same account, while a plain Java {@code toLowerCase} would not — an
     * attacker could rotate spellings that resolve to the same login and land in a fresh bucket each
     * time. When the submitted address matched an existing account, the canonical stored email is used
     * as the bucket key, so every spelling MySQL treats as that account shares one counter.
     *
     * <p>Only the database's own equality is used; no extra folding is applied, so two genuinely
     * distinct accounts (which the {@code UNIQUE} email index already guarantees cannot be
     * collation-equal) can never be merged into one bucket.
     */
    public static String accountIdentity(String storedEmail, String submitted) {
        if (storedEmail != null && !storedEmail.isBlank()) return storedEmail.trim();
        return normalizeAccount(submitted);
    }

    /** Bucket keys are hashed so raw IPs and email addresses are not retained in the throttle table. */
    public static String key(String scope, String value) {
        return Passwords.sha256(scope + "\u0000" + (value == null ? "" : value));
    }

    /**
     * Reserves an attempt and reports whether the caller may continue with credential verification.
     *
     * @param nowIso current time; injected so window behaviour is testable without sleeping
     */
    public static Decision evaluate(Store store, Config config, String ip, String account, String nowIso) {
        if (store == null || config == null) return Decision.permit(null);
        String now = secondIso(nowIso);
        String windowStart = Clock.addSecondsIso(now, -config.loginWindowSeconds);
        String ipKey = key(SCOPE_IP, ip == null || ip.isBlank() ? "unknown" : ip);
        String accountKey = key(SCOPE_ACCOUNT, normalizeAccount(account));

        String reservationId = store.record(ipKey, accountKey, now);
        try {
            long ipCount = store.countByIp(ipKey, windowStart);
            if (ipCount > config.loginMaxAttemptsPerIp) {
                store.release(reservationId);
                return Decision.blocked(SCOPE_IP, retryAfter(store.oldestByIp(ipKey, windowStart), now, config.loginWindowSeconds), null);
            }
            long accountCount = store.countByAccount(accountKey, windowStart);
            if (accountCount > config.loginMaxAttemptsPerAccount) {
                store.release(reservationId);
                return Decision.blocked(SCOPE_ACCOUNT, retryAfter(store.oldestByAccount(accountKey, windowStart), now, config.loginWindowSeconds), null);
            }
            return Decision.permit(reservationId);
        } catch (RuntimeException error) {
            // Fail closed: never let a storage problem silently disable throttling.
            store.release(reservationId);
            throw error;
        }
    }

    /**
     * Same policy as {@link #evaluate}, but the reserve+count critical section is serialised across
     * every API process with a MySQL named advisory lock (audit finding D3). Used by the login route.
     *
     * <p>Non-database stores (used by unit tests) are evaluated directly — the lock exists only to
     * coordinate real MySQL sessions.
     */
    public static Decision evaluateLocked(Store store, Config config, String ip, String account, String nowIso) {
        if (!(store instanceof DbStore)) return evaluate(store, config, ip, account, nowIso);
        return Db.withConnection(() -> {
            if (!Db.acquireLock(LOCK_NAME, LOCK_TIMEOUT_SECONDS)) {
                // Fail closed: without the lock we cannot guarantee the limit, so refuse the sign-in.
                throw new ApiException(503, "LOGIN_BUSY",
                        "Sign-in is temporarily unavailable. Please try again in a moment.");
            }
            try {
                return evaluate(store, config, ip, account, nowIso);
            } finally {
                Db.releaseLock(LOCK_NAME);
            }
        });
    }

    /**
     * Clears this sign-in's own traces: the attempt row reserved for this request (so a successful
     * login never counts against the IP) plus this account's earlier failed attempts.
     *
     * <p>Nothing else is touched: another account's history and another IP's history stay intact.
     */
    public static void clearOnSuccess(Store store, String account, Decision decision) {
        if (store == null) return;
        store.clearAccount(key(SCOPE_ACCOUNT, normalizeAccount(account)));
        if (decision != null && decision.reservationId() != null) store.release(decision.reservationId());
    }

    /** Releases this request's reservation only (used when the request is abandoned before auth). */
    public static void release(Store store, Decision decision) {
        if (store == null || decision == null || decision.reservationId() == null) return;
        store.release(decision.reservationId());
    }

    /** MySQL-backed store. A named type so {@link #evaluateLocked} can detect it. */
    private static final class DbStore implements Store {
        @Override
        public String record(String ipKey, String accountKey, String attemptedAtIso) {
            String id = Clock.newId("lta");
            Db.exec(
                    "INSERT INTO login_throttle_attempts (id, ip_key, account_key, attempted_at) VALUES (?, ?, ?, ?)",
                    id, ipKey, accountKey, attemptedAtIso);
            if (ATTEMPT_COUNTER.incrementAndGet() % PRUNE_EVERY_N_ATTEMPTS == 0) {
                try {
                    pruneBefore(Clock.addSecondsIso(Clock.nowIso(), -PRUNE_RETENTION_SECONDS));
                } catch (RuntimeException ignored) {
                    /* pruning is opportunistic; never fail a login because of it */
                }
            }
            return id;
        }

        @Override
        public void release(String id) {
            if (id == null) return;
            Db.exec("DELETE FROM login_throttle_attempts WHERE id = ?", id);
        }

        @Override
        public long countByIp(String ipKey, String sinceIso) {
            return Db.count(
                    "SELECT COUNT(*) AS count FROM login_throttle_attempts WHERE ip_key = ? AND attempted_at >= ?",
                    ipKey, sinceIso);
        }

        @Override
        public long countByAccount(String accountKey, String sinceIso) {
            return Db.count(
                    "SELECT COUNT(*) AS count FROM login_throttle_attempts WHERE account_key = ? AND attempted_at >= ?",
                    accountKey, sinceIso);
        }

        @Override
        public long clearAccount(String accountKey) {
            return Db.exec("DELETE FROM login_throttle_attempts WHERE account_key = ?", accountKey);
        }

        @Override
        public String oldestByIp(String ipKey, String sinceIso) {
            java.util.Map<String, Object> row = Db.one(
                    "SELECT MIN(attempted_at) AS oldest FROM login_throttle_attempts WHERE ip_key = ? AND attempted_at >= ?",
                    ipKey, sinceIso);
            return row == null ? null : Db.str(row, "oldest");
        }

        @Override
        public String oldestByAccount(String accountKey, String sinceIso) {
            java.util.Map<String, Object> row = Db.one(
                    "SELECT MIN(attempted_at) AS oldest FROM login_throttle_attempts WHERE account_key = ? AND attempted_at >= ?",
                    accountKey, sinceIso);
            return row == null ? null : Db.str(row, "oldest");
        }

        @Override
        public int pruneBefore(String beforeIso) {
            return Db.exec("DELETE FROM login_throttle_attempts WHERE attempted_at < ?", beforeIso);
        }
    }

    /**
     * Seconds until the oldest attempt in the window falls out of it (audit finding D4).
     *
     * <p>Stored timestamps are truncated to whole seconds (see {@link #secondIso}), so the elapsed time
     * is over-estimated by up to one second and a naive subtraction can under-state the wait. One
     * second is therefore added: the hint never tells a client to retry before the limit has actually
     * expired. The result is bounded by {@code windowSeconds + 1}.
     */
    private static final Store DB_STORE = new DbStore();

    /** MySQL-backed store used by the API (shared across requests; stateless). */
    public static Store dbStore() {
        return DB_STORE;
    }

    private static long retryAfter(String oldestIso, String nowIso, int windowSeconds) {
        long fallback = Math.max(1L, windowSeconds);
        if (oldestIso == null || oldestIso.isBlank()) return fallback;
        try {
            long elapsed = (Instant.parse(nowIso).toEpochMilli() - Instant.parse(oldestIso).toEpochMilli()) / 1000L;
            long remaining = windowSeconds - elapsed;
            if (remaining < 1L) remaining = 1L;
            return Math.min(remaining + 1L, (long) windowSeconds + 1L);
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    /**
     * Normalizes timestamps to whole seconds so lexicographic comparison of the stored ISO strings
     * always matches chronological order (ISO_INSTANT drops the fraction when it is zero).
     */
    static String secondIso(String iso) {
        if (iso == null) return Clock.nowIso();
        try {
            return DateTimeFormatter.ISO_INSTANT.format(Instant.parse(iso).truncatedTo(ChronoUnit.SECONDS));
        } catch (RuntimeException ignored) {
            return iso;
        }
    }
}
