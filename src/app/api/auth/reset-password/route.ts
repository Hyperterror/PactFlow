import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/http";
import { consumePasswordReset } from "@/lib/auth/password-reset";

/**
 * Password reset completion.
 *
 * A expired or already-used token is answered with the same shape as an
 * unknown one — the caller learns only that the link does not work, never
 * whether it once did.
 */
const ResetSchema = z.object({
  token: z.string().min(1).max(512),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(200, "Password must be at most 200 characters."),
});

export const POST = handler(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = ResetSchema.parse(body);

  const outcome = await consumePasswordReset(parsed.token, parsed.password);

  if (outcome === "ok") {
    return json({ message: "Password updated. Sign in with your new password." });
  }

  return json(
    {
      error: "RESET_LINK_INVALID",
      message:
        outcome === "expired"
          ? "That reset link has expired. Request a new one."
          : "That reset link is no longer valid. Request a new one.",
    },
    400,
  );
});
