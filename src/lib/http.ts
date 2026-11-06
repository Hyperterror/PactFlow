import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { AppError, ValidationError, errorBody } from "@/lib/errors";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Converts any thrown value into the design.md error envelope. */
export function toResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "VALIDATION_ERROR",
        message: "The submitted data is invalid.",
        fields: error.issues.map((issue) => ({
          field: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }
  const { status, body } = errorBody(error);
  if (status >= 500) {
    // Unexpected failures are surfaced to the server log, never silently swallowed.
    console.error("[api] unhandled error", error);
  }
  return NextResponse.json(body, { status });
}

/** Wraps a route handler with uniform error mapping. */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<NextResponse | Response>,
): (...args: T) => Promise<NextResponse | Response> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      return toResponse(error);
    }
  };
}

/** Parses and validates a JSON request body. Throws ValidationError on malformed input. */
export async function parseJson<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ValidationError([{ field: "(root)", message: "Body must be valid JSON." }]);
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: NextRequest, schema: ZodSchema<T>): T {
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return schema.parse(params);
}

/** Extracts the client IP, used for logging lockouts and violations. */
export function clientIp(req: Request): string {
  const header = req.headers.get("x-forwarded-for");
  if (header) return header.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export { AppError };
