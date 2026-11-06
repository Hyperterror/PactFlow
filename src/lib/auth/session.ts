import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { prisma } from "@/lib/prisma";
import { UnauthorizedError } from "@/lib/errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export const MAX_CALLBACK_URL_LENGTH = 2048;

/**
 * Requirement 1.7: the post-login redirect target is preserved but capped at
 * 2048 characters and restricted to same-origin relative paths.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback = "/briefs"): string {
  if (!raw) return fallback;
  const trimmed = raw.slice(0, MAX_CALLBACK_URL_LENGTH);
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return fallback;
  return trimmed;
}

/** Validates that the JWT still maps to a live Server-recorded session. */
async function resolveSession(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;

  const token = (session as { sid?: string } | null)?.sid;
  if (token) {
    const record = await prisma.session.findUnique({ where: { sessionToken: token } });
    if (!record || record.expiresAt.getTime() <= Date.now()) return null;
  }

  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name ?? "",
  };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return resolveSession();
}

/** Throws HTTP 401 when there is no valid session. Use inside Route Handlers. */
export async function requireSession(): Promise<SessionUser> {
  const user = await resolveSession();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** For server components: redirects browsers to /login preserving the target. */
export async function requirePageSession(callbackUrl?: string): Promise<SessionUser> {
  const user = await resolveSession();
  if (!user) {
    const target = safeCallbackUrl(callbackUrl, "/briefs");
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}`);
  }
  return user;
}

/** Revokes the persisted session row, invalidating the JWT on the next request. */
export async function revokeSessionByToken(sessionToken: string): Promise<void> {
  await prisma.session.deleteMany({ where: { sessionToken } });
}
