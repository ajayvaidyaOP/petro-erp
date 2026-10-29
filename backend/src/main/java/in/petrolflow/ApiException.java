package in.petrolflow;

import java.util.Map;

public final class ApiException extends RuntimeException {
    public final int status;
    public final String code;
    public final Object details;

    public ApiException(int status, String code, String message) {
        this(status, code, message, null);
    }

    public ApiException(int status, String code, String message, Object details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(400, "BAD_REQUEST", message);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(401, "UNAUTHORIZED", message);
    }

    public static ApiException forbidden() {
        return forbidden("You do not have permission to perform this action");
    }

    public static ApiException forbidden(String message) {
        return new ApiException(403, "FORBIDDEN", message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(404, "NOT_FOUND", message);
    }

    public static ApiException conflict(String message) {
        return new ApiException(409, "CONFLICT", message);
    }

    public static ApiException unprocessable(String message) {
        return unprocessable(message, null);
    }

    public static ApiException unprocessable(String message, Object details) {
        return new ApiException(422, "UNPROCESSABLE", message, details);
    }

    public static ApiException validation(String path, String message) {
        return unprocessable("Validation failed", Map.of(
                "issues", java.util.List.of(Map.of("path", path, "message", message))
        ));
    }
}
