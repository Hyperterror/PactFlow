import { prisma } from "@/lib/prisma";
import { withTransaction, writeAuditLog } from "@/lib/audit";

/** Requirement 1.8: 5 failures inside 15 minutes locks the account for 15 minutes. */
export const MAX_FAILED_ATTEMPTS = 5;
export const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  lockedUntil?: Date;
  failuresInWindow: number;
}

/**
 * Counts failed attempts inside the sliding window and reports whether the
 * account is currently locked. Locked accounts stay locked until the recorded
 * `lockedUntil` timestamp passes.
 */
export async function checkLoginRateLimit(
  email: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const normalized = email.trim().toLowerCase();

  const locked = await prisma.loginAttempt.findFirst({
    where: { email: normalized, lockedUntil: { gt: now } },
    orderBy: { lockedUntil: "desc" },
  });
  if (locked?.lockedUntil) {
    return { allowed: false, lockedUntil: locked.lockedUntil, failuresInWindow: MAX_FAILED_ATTEMPTS };
  }

  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: { email: normalized, success: false, attemptedAt: { gte: windowStart } },
  });

  // A lock was already issued inside the window and has not been cleared.
  const activeLock = await prisma.loginAttempt.findFirst({
    where: { email: normalized, lockedUntil: { gte: windowStart } },
    orderBy: { attemptedAt: "desc" },
  });
  if (activeLock?.lockedUntil && activeLock.lockedUntil > now) {
    return { allowed: false, lockedUntil: activeLock.lockedUntil, failuresInWindow: failures };
  }

  return { allowed: failures < MAX_FAILED_ATTEMPTS, failuresInWindow: failures };
}

/**
 * Records a failed attempt and locks the account when the threshold is met.
 * Returns the lock timestamp when a lock was applied.
 */
export async function recordLoginFailure(
  email: string,
  options: { userId?: string; now?: Date; ip?: string } = {},
): Promise<{ lockedUntil?: Date }> {
  const now = options.now ?? new Date();
  const normalized = email.trim().toLowerCase();

  const attempt = await prisma.loginAttempt.create({
    data: { email: normalized, userId: options.userId, success: false, attemptedAt: now },
  });

  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const failures = await prisma.loginAttempt.count({
    where: { email: normalized, success: false, attemptedAt: { gte: windowStart } },
  });

  if (failures >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
    await prisma.loginAttempt.update({ where: { id: attempt.id }, data: { lockedUntil } });
    if (options.userId) {
      // Requirement 1.8: log the lockout event.
      await withTransaction(async (tx) => {
        await writeAuditLog(tx, {
          eventType: "ACCOUNT_LOCKED",
          actorId: options.userId as string,
          resourceId: options.userId as string,
          resourceType: "User",
          previousState: "ACTIVE",
          newState: "LOCKED",
          metadata: { email: normalized, ip: options.ip ?? "unknown", failures },
        });
      });
    }
    return { lockedUntil };
  }

  return {};
}

/** Clears the failure window after a successful login. */
export async function clearLoginAttempts(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await prisma.loginAttempt.deleteMany({ where: { email: normalized, success: false } });
}

export async function recordLoginSuccess(
  email: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await prisma.loginAttempt.create({
    data: { email: email.trim().toLowerCase(), userId, success: true, attemptedAt: now },
  });
}
