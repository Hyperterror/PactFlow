/**
 * Thin fetch wrapper for Client Components.
 *
 * Route handlers answer with the design.md envelope
 * (`{ error, message, fields? }`), so this module turns that envelope into a
 * typed error the forms can render field-by-field.
 */

export interface ApiFieldError {
  field: string;
  message: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ApiFieldError[];
  readonly currentState?: string;
  readonly reason?: string;

  constructor(
    message: string,
    options: { status: number; code: string; fields?: ApiFieldError[]; currentState?: string; reason?: string },
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = options.status;
    this.code = options.code;
    this.fields = options.fields ?? [];
    this.currentState = options.currentState;
    this.reason = options.reason;
  }

  /** Field name → first message, ready to spread into form state. */
  fieldMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const field of this.fields) {
      if (!map[field.field]) map[field.field] = field.message;
    }
    return map;
  }
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return { message: text.slice(0, 300) };
  }
}

export async function apiRequest<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
    credentials: "same-origin",
  });

  const body = await readBody(response);

  if (!response.ok) {
    const fields = Array.isArray(body.fields)
      ? (body.fields as ApiFieldError[]).filter(
          (field) => typeof field?.field === "string" && typeof field?.message === "string",
        )
      : [];
    throw new ApiRequestError(
      typeof body.message === "string" ? body.message : `Request failed (${response.status}).`,
      {
        status: response.status,
        code: typeof body.error === "string" ? body.error : "REQUEST_FAILED",
        fields,
        currentState: typeof body.currentState === "string" ? body.currentState : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      },
    );
  }

  return body as T;
}

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
