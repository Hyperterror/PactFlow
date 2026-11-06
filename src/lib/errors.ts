/**
 * Error taxonomy for the API surface.
 *
 * Response envelopes follow design.md:
 *  - validation  → { error: "VALIDATION_ERROR", fields: [{ field, message }] }
 *  - state       → { error: "STATE_CONFLICT", code, message, currentState? }
 *  - forbidden   → { error: "FORBIDDEN", reason, message }
 */

export type FieldError = { field: string; message: string };

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  readonly fields: FieldError[];
  constructor(fields: FieldError[], message = "The submitted data is invalid.") {
    super(400, "VALIDATION_ERROR", message);
    this.fields = fields;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required.", code = "UNAUTHENTICATED") {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  readonly reason: string;
  constructor(reason: string, message = "You are not allowed to perform this action.") {
    super(403, "FORBIDDEN", message);
    this.reason = reason;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "NOT_FOUND", `${resource} not found.`);
  }
}

export class ConflictError extends AppError {
  readonly currentState?: string;
  constructor(code: string, message: string, currentState?: string) {
    super(409, "STATE_CONFLICT", message);
    this.currentState = currentState;
  }
}

export class ExternalServiceError extends AppError {
  constructor(code: string, message: string) {
    super(502, code, message);
  }
}

export function errorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof ValidationError) {
    return {
      status: error.status,
      body: { error: "VALIDATION_ERROR", message: error.message, fields: error.fields },
    };
  }
  if (error instanceof ForbiddenError) {
    return {
      status: error.status,
      body: { error: "FORBIDDEN", reason: error.reason, message: error.message },
    };
  }
  if (error instanceof ConflictError) {
    return {
      status: error.status,
      body: {
        error: "STATE_CONFLICT",
        code: error.code,
        message: error.message,
        ...(error.currentState ? { currentState: error.currentState } : {}),
      },
    };
  }
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.code, message: error.message } };
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  return { status: 500, body: { error: "INTERNAL_ERROR", message } };
}
