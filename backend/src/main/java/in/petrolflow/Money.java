package in.petrolflow;

import java.math.BigDecimal;
import java.math.RoundingMode;

public final class Money {
    private Money() {}

    public static BigDecimal d(Object value) {
        if (value == null) return BigDecimal.ZERO;
        if (value instanceof BigDecimal decimal) return decimal;
        if (value instanceof Number number) {
            if (number instanceof Long || number instanceof Integer || number instanceof Short) {
                return BigDecimal.valueOf(number.longValue());
            }
            return new BigDecimal(number.toString());
        }
        String text = String.valueOf(value).trim();
        if (text.isEmpty() || "null".equals(text)) return BigDecimal.ZERO;
        try {
            return new BigDecimal(text);
        } catch (NumberFormatException ignored) {
            return BigDecimal.ZERO;
        }
    }

    public static String money(Object value) {
        return d(value).setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    public static String litres(Object value) {
        return d(value).setScale(3, RoundingMode.HALF_UP).toPlainString();
    }

    public static String rate(Object value) {
        return litres(value);
    }

    public static String fixed(Object value, int scale) {
        return d(value).setScale(scale, RoundingMode.HALF_UP).toPlainString();
    }

    public static String percent(Object part, Object whole, int decimals) {
        BigDecimal denominator = d(whole);
        if (denominator.signum() == 0) return "0";
        return d(part).multiply(BigDecimal.valueOf(100))
                .divide(denominator, decimals, RoundingMode.HALF_UP)
                .toPlainString();
    }

    public static boolean isZero(Object value) {
        return d(value).signum() == 0;
    }
}
