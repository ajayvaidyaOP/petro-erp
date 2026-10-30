package in.petrolflow;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

public final class Clock {
    public static final int IST_OFFSET_MINUTES = 330;
    private static final ZoneOffset IST = ZoneOffset.ofHoursMinutes(5, 30);

    private Clock() {}

    public static String nowIso() {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.now().truncatedTo(ChronoUnit.MILLIS));
    }

    public static String addHoursIso(String iso, int hours) {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.parse(iso).plus(hours, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MILLIS));
    }

    public static String addSecondsIso(String iso, long seconds) {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.parse(iso).plus(seconds, ChronoUnit.SECONDS).truncatedTo(ChronoUnit.MILLIS));
    }

    public static String addDays(String date, int days) {
        return LocalDate.parse(date).plusDays(days).toString();
    }

    public static String todayIst() {
        return Instant.now().atOffset(IST).toLocalDate().toString();
    }

    public static String businessDateOf(String iso) {
        return Instant.parse(iso).atOffset(IST).toLocalDate().toString();
    }

    public static String istDayStart(String day) {
        LocalDate date = LocalDate.parse(day);
        Instant start = date.atStartOfDay().toInstant(IST);
        return DateTimeFormatter.ISO_INSTANT.format(start.truncatedTo(ChronoUnit.MILLIS));
    }

    public static String istDayEnd(String day) {
        Instant start = Instant.parse(istDayStart(day));
        return DateTimeFormatter.ISO_INSTANT.format(start.plus(86_400_000 - 1, ChronoUnit.MILLIS));
    }

    public static boolean isIsoDate(String value) {
        if (value == null || !value.matches("\\d{4}-\\d{2}-\\d{2}")) return false;
        try {
            return LocalDate.parse(value).toString().equals(value);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    public static String newId(String prefix) {
        return prefix + "_" + java.util.UUID.randomUUID();
    }
}
