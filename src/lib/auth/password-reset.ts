import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { withTransaction, writeAuditLog } from "@/lib/audit";

/**
 * Account recovery.
 *
 * Requirement 1.5's rule — never disclose whether an account exists — applies
 * here too: `requestPasswordReset` returns nothing, and the route answers with
 * the same message whether or not the address is registered.
 *
 * Only the SHA-256 of the token is persisted. A database leak therefore yields
 * hashes, not working reset links.
 */

const TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time comparison of two hex digests. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Issues a single-use reset token. Returns the raw token so a development
 * deployment can surface the link; production would hand it to a mailer
 * instead and return nothing.
 */
export async function issuePasswordResetToken(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return null;

  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  // Any earlier outstanding token is retired so only the newest link works.
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt },
  });

  return raw;
}

export type ResetOutcome = "ok" | "invalid" | "expired";

/**
 * Consumes a reset token and sets the new password. A successful reset also
 * revokes every existing session and clears any login lockout, because both
 * would otherwise leave the user unable to actually get back in.
 */
export async function consumePasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<ResetOutcome> {
  if (!rawToken) return "invalid";
  const tokenHash = hashToken(rawToken);

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!record || record.usedAt) return "invalid";
  if (!digestsMatch(record.tokenHash, tokenHash)) return "invalid";
  if (record.expiresAt.getTime() <= Date.now()) return "expired";

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (tx) => {
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    // Every session dies with the old password.
    await tx.session.deleteMany({ where: { userId: record.userId } });

    await writeAuditLog(tx, {
      eventType: "PASSWORD_RESET",
      actorId: record.userId,
      resourceId: record.userId,
      resourceType: "User",
      previousState: "ACTIVE",
      newState: "PASSWORD_CHANGED",
      metadata: { via: "reset_token" },
    });
  });

  // Lockout rows live outside the transaction's audit trail and are keyed by
  // email, so they are cleared separately.
  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  if (user) {
    await prisma.loginAttempt.deleteMany({ where: { email: user.email, success: false } });
  }

  return "ok";
}
