export type ErrorDetails = Record<string, unknown> | unknown[] | undefined;

/**
 * Application error with an HTTP status and a stable machine-readable code.
 * The global error handler serialises these as { error: { code, message, details } }.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly expose: boolean;

  constructor(status: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = status < 500;
  }
}

export const badRequest = (message = 'Bad request', details?: ErrorDetails) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message = 'Request conflicts with the current state', details?: ErrorDetails) =>
  new AppError(409, 'CONFLICT', message, details);

export const unprocessable = (message = 'Unprocessable request', details?: ErrorDetails) =>
  new AppError(422, 'UNPROCESSABLE', message, details);

export const tooManyRequests = (message = 'Too many requests — please slow down') =>
  new AppError(429, 'RATE_LIMITED', message);

export const internalError = (message = 'Something went wrong on our side') =>
  new AppError(500, 'INTERNAL_ERROR', message);

export const serviceUnavailable = (message = 'Service temporarily unavailable') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);
