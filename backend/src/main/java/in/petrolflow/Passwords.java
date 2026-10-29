package in.petrolflow;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

/**
 * Password hashes are {@code pbkdf2$iterations$salt$hash} (HMAC-SHA256, UTF-8).
 * The implementation is local so it matches Python's hashlib.pbkdf2_hmac exactly.
 */
public final class Passwords {
    private static final int ITERATIONS = 120_000;
    private static final int DK_LEN = 32;
    private static final SecureRandom RANDOM = new SecureRandom();

    private Passwords() {}

    public static String hash(String password) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        byte[] dk = pbkdf2(password.getBytes(StandardCharsets.UTF_8), salt, ITERATIONS, DK_LEN);
        return "pbkdf2$" + ITERATIONS + "$" + b64(salt) + "$" + b64(dk);
    }

    public static boolean verify(String password, String stored) {
        if (password == null || stored == null) return false;
        String[] parts = stored.split("\\$");
        if (parts.length != 4 || !"pbkdf2".equals(parts[0])) return false;
        try {
            int iterations = Integer.parseInt(parts[1]);
            if (iterations < 10_000 || iterations > 2_000_000) return false;
            byte[] salt = b64decode(parts[2]);
            byte[] expected = b64decode(parts[3]);
            byte[] actual = pbkdf2(password.getBytes(StandardCharsets.UTF_8), salt, iterations, expected.length);
            return MessageDigest.isEqual(expected, actual);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    public static void assertStrength(String password) {
        if (password == null || password.length() < 10) {
            throw ApiException.unprocessable("Password must be at least 10 characters long");
        }
        if (!password.matches(".*[A-Za-z].*") || !password.matches(".*[0-9].*")) {
            throw ApiException.unprocessable("Password must contain at least one letter and one number");
        }
    }

    public static String sha256(String value) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return b64(bytes);
    }

    static byte[] pbkdf2(byte[] password, byte[] salt, int iterations, int dkLen) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(password, "HmacSHA256"));
            int hashLen = mac.getMacLength();
            int blocks = (dkLen + hashLen - 1) / hashLen;
            byte[] out = new byte[blocks * hashLen];
            byte[] block = new byte[salt.length + 4];
            System.arraycopy(salt, 0, block, 0, salt.length);
            for (int i = 1; i <= blocks; i++) {
                block[salt.length] = (byte) (i >>> 24);
                block[salt.length + 1] = (byte) (i >>> 16);
                block[salt.length + 2] = (byte) (i >>> 8);
                block[salt.length + 3] = (byte) i;
                byte[] u = mac.doFinal(block);
                byte[] t = Arrays.copyOf(u, u.length);
                for (int j = 1; j < iterations; j++) {
                    u = mac.doFinal(u);
                    for (int k = 0; k < t.length; k++) t[k] ^= u[k];
                }
                System.arraycopy(t, 0, out, (i - 1) * hashLen, hashLen);
            }
            return Arrays.copyOf(out, dkLen);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static byte[] b64decode(String value) {
        return Base64.getUrlDecoder().decode(value);
    }
}
