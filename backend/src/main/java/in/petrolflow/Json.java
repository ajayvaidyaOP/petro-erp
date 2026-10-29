package in.petrolflow;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small JSON codec. Objects keep insertion order so API payloads stay stable. */
public final class Json {
    private Json() {}

    public static Object parse(String text) {
        if (text == null || text.isBlank()) return new LinkedHashMap<String, Object>();
        return new Parser(text).parseValue();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (var entry : map.entrySet()) out.put(String.valueOf(entry.getKey()), entry.getValue());
            return out;
        }
        return new LinkedHashMap<>();
    }

    public static String stringify(Object value) {
        StringBuilder out = new StringBuilder();
        write(out, value);
        return out.toString();
    }

    public static String camel(String key) {
        StringBuilder out = new StringBuilder();
        boolean upper = false;
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c == '_') {
                upper = true;
                continue;
            }
            out.append(upper ? Character.toUpperCase(c) : c);
            upper = false;
        }
        return out.toString();
    }

    public static Map<String, Object> shape(Map<String, Object> row) {
        return shape(row, List.of());
    }

    public static Map<String, Object> shape(Map<String, Object> row, List<String> jsonColumns) {
        if (row == null) return null;
        var jsonKeys = new java.util.HashSet<String>();
        for (String column : jsonColumns) jsonKeys.add(camel(column));
        Map<String, Object> out = new LinkedHashMap<>();
        for (var entry : row.entrySet()) {
            String key = camel(entry.getKey());
            Object value = entry.getValue();
            if (jsonKeys.contains(key) && value instanceof String text) {
                try {
                    value = parse(text);
                } catch (RuntimeException ignored) {
                    value = null;
                }
            }
            out.put(key, value);
        }
        return out;
    }

    public static List<Map<String, Object>> shapeAll(List<Map<String, Object>> rows) {
        return shapeAll(rows, List.of());
    }

    public static List<Map<String, Object>> shapeAll(List<Map<String, Object>> rows, List<String> jsonColumns) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (var row : rows) out.add(shape(row, jsonColumns));
        return out;
    }

    private static void write(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String text) {
            out.append('"');
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                switch (c) {
                    case '"' -> out.append("\\\"");
                    case '\\' -> out.append("\\\\");
                    case '\b' -> out.append("\\b");
                    case '\f' -> out.append("\\f");
                    case '\n' -> out.append("\\n");
                    case '\r' -> out.append("\\r");
                    case '\t' -> out.append("\\t");
                    default -> {
                        if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                        else out.append(c);
                    }
                }
            }
            out.append('"');
        } else if (value instanceof Boolean || value instanceof Integer || value instanceof Long) {
            out.append(value);
        } else if (value instanceof Number number) {
            out.append(number.toString());
        } else if (value instanceof Map<?, ?> map) {
            out.append('{');
            boolean first = true;
            for (var entry : map.entrySet()) {
                if (!first) out.append(',');
                first = false;
                write(out, String.valueOf(entry.getKey()));
                out.append(':');
                write(out, entry.getValue());
            }
            out.append('}');
        } else if (value instanceof Iterable<?> list) {
            out.append('[');
            boolean first = true;
            for (Object item : list) {
                if (!first) out.append(',');
                first = false;
                write(out, item);
            }
            out.append(']');
        } else {
            write(out, String.valueOf(value));
        }
    }

    private static final class Parser {
        private final String text;
        private int i;

        Parser(String text) {
            this.text = text;
        }

        Object parseValue() {
            skip();
            Object value = read();
            skip();
            if (i < text.length()) throw new IllegalArgumentException("Unexpected trailing JSON");
            return value;
        }

        private Object read() {
            skip();
            if (i >= text.length()) throw new IllegalArgumentException("Unexpected end of JSON");
            char c = text.charAt(i);
            if (c == '{') return readObject();
            if (c == '[') return readArray();
            if (c == '"') return readString();
            if (c == 't' || c == 'f') return readBoolean();
            if (c == 'n') return readNull();
            return readNumber();
        }

        private Map<String, Object> readObject() {
            expect('{');
            Map<String, Object> out = new LinkedHashMap<>();
            skip();
            if (peek('}')) {
                i++;
                return out;
            }
            while (true) {
                skip();
                String key = readString();
                skip();
                expect(':');
                out.put(key, read());
                skip();
                if (peek('}')) {
                    i++;
                    break;
                }
                expect(',');
            }
            return out;
        }

        private List<Object> readArray() {
            expect('[');
            List<Object> out = new ArrayList<>();
            skip();
            if (peek(']')) {
                i++;
                return out;
            }
            while (true) {
                out.add(read());
                skip();
                if (peek(']')) {
                    i++;
                    break;
                }
                expect(',');
            }
            return out;
        }

        private String readString() {
            expect('"');
            StringBuilder out = new StringBuilder();
            while (i < text.length()) {
                char c = text.charAt(i++);
                if (c == '"') return out.toString();
                if (c == '\\') {
                    if (i >= text.length()) break;
                    char e = text.charAt(i++);
                    switch (e) {
                        case '"', '\\', '/' -> out.append(e);
                        case 'b' -> out.append('\b');
                        case 'f' -> out.append('\f');
                        case 'n' -> out.append('\n');
                        case 'r' -> out.append('\r');
                        case 't' -> out.append('\t');
                        case 'u' -> {
                            if (i + 4 > text.length()) throw new IllegalArgumentException("Bad unicode escape");
                            out.append((char) Integer.parseInt(text.substring(i, i + 4), 16));
                            i += 4;
                        }
                        default -> throw new IllegalArgumentException("Bad escape");
                    }
                } else {
                    out.append(c);
                }
            }
            throw new IllegalArgumentException("Unterminated string");
        }

        private Object readNumber() {
            int start = i;
            if (peek('-')) i++;
            while (i < text.length() && Character.isDigit(text.charAt(i))) i++;
            boolean decimal = false;
            if (i < text.length() && text.charAt(i) == '.') {
                decimal = true;
                i++;
                while (i < text.length() && Character.isDigit(text.charAt(i))) i++;
            }
            if (i < text.length() && (text.charAt(i) == 'e' || text.charAt(i) == 'E')) {
                decimal = true;
                i++;
                if (i < text.length() && (text.charAt(i) == '+' || text.charAt(i) == '-')) i++;
                while (i < text.length() && Character.isDigit(text.charAt(i))) i++;
            }
            String raw = text.substring(start, i);
            if (!decimal) {
                try {
                    return Long.parseLong(raw);
                } catch (NumberFormatException ignored) {
                    return new java.math.BigDecimal(raw);
                }
            }
            return new java.math.BigDecimal(raw);
        }

        private Boolean readBoolean() {
            if (text.startsWith("true", i)) {
                i += 4;
                return Boolean.TRUE;
            }
            if (text.startsWith("false", i)) {
                i += 5;
                return Boolean.FALSE;
            }
            throw new IllegalArgumentException("Expected boolean");
        }

        private Object readNull() {
            if (!text.startsWith("null", i)) throw new IllegalArgumentException("Expected null");
            i += 4;
            return null;
        }

        private void skip() {
            while (i < text.length() && Character.isWhitespace(text.charAt(i))) i++;
        }

        private boolean peek(char c) {
            return i < text.length() && text.charAt(i) == c;
        }

        private void expect(char c) {
            skip();
            if (i >= text.length() || text.charAt(i) != c) {
                throw new IllegalArgumentException("Expected '" + c + "'");
            }
            i++;
        }
    }
}
