import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { RegisterSchema, registerUser } from "@/lib/auth/register";
import { ValidationError } from "@/lib/errors";

/**
 * Requirement 1.1/1.2 — registration endpoint.
 * A duplicate email returns a validation error naming the field, and no account
 * is created.
 */
export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as unknown;
  if (body === null) {
    throw new ValidationError([{ field: "(root)", message: "Body must be valid JSON." }]);
  }

  const input = RegisterSchema.parse(body);
  const user = await registerUser(input);
  return json({ user }, 201);
});
