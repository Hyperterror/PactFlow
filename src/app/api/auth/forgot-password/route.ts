import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/http";
import { issuePasswordResetToken } from "@/lib/auth/password-reset";

/**
 * Password reset request.
 *
 * The response is identical whether or not the address is registered, so the
 * endpoint cannot be used to enumerate accounts (the same rule the login form
 * follows). In development the raw token is returned so the flow is demoable
 * without a mail transport; production must deliver it out of band and omit
 * `devResetUrl` entirely.
 */
const ForgotSchema = z.object({
  email: z.string().trim().min(1).max(254),
});

const GENERIC_RESPONSE =
  "If an account exists for that address, a reset link has been created.";

export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = ForgotSchema.safeParse(body);

  // Malformed input still yields the generic answer: telling the caller which
  // part of the request was wrong leaks nothing useful and only helps probing.
  if (!parsed.success) {
    return json({ message: GENERIC_RESPONSE });
  }

  const token = await issuePasswordResetToken(parsed.data.email);

  if (process.env.NODE_ENV !== "production" && token) {
    return json({
      message: GENERIC_RESPONSE,
      devResetUrl: `/reset-password?token=${encodeURIComponent(token)}`,
    });
  }

  return json({ message: GENERIC_RESPONSE });
});
