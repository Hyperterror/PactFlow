import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/auth/rate-limit";
import { isHttpsDeployment } from "@/lib/auth/session-token";

const CredentialsSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
});

const SESSION_MAX_AGE_SECONDS = 86_400; // 24 hours (Requirement 1.3)

/** Thrown for every credential failure so the reason is never disclosed (Requirement 1.5). */
class InvalidCredentials extends CredentialsSignin {
  code = "invalid_credentials";
}

class AccountLocked extends CredentialsSignin {
  code = "account_locked";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? "pactflow-development-secret",
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login", error: "/login" },
  cookies: {
    sessionToken: {
      // `secure` is only usable when the app is actually served over HTTPS;
      // production deployments enforce it, plain-HTTP localhost cannot.
      name: isHttpsDeployment() ? "__Secure-authjs.session-token" : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        secure: isHttpsDeployment(),
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = CredentialsSchema.safeParse(credentials);
        if (!parsed.success) throw new InvalidCredentials();

        const email = parsed.data.email.toLowerCase();
        const limit = await checkLoginRateLimit(email);
        if (!limit.allowed) {
          const user = await prisma.user.findUnique({ where: { email } });
          console.warn(
            `[auth] locked account login attempt email=${email} ip=unknown lockedUntil=${limit.lockedUntil?.toISOString() ?? "n/a"}`,
          );
          void user;
          throw new AccountLocked();
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          await recordLoginFailure(email, {});
          throw new InvalidCredentials();
        }

        const valid = await verifyPassword(parsed.data.password, user.passwordHash);
        if (!valid) {
          await recordLoginFailure(email, { userId: user.id });
          throw new InvalidCredentials();
        }

        await clearLoginAttempts(email);
        await recordLoginSuccess(email, user.id);

        return { id: user.id, email: user.email, name: user.displayName };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.uid = user.id;
        // Requirement 1.4: persist a session row with the UTC start timestamp so
        // sessions can be audited and revoked server-side.
        const sessionToken = randomUUID();
        const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
        await prisma.session.create({
          data: { userId: user.id as string, sessionToken, expiresAt },
        });
        token.sid = sessionToken;
        token.displayName = user.name ?? "";
      }
      if (trigger === "update" && token.uid) {
        const fresh = await prisma.user.findUnique({ where: { id: token.uid as string } });
        if (fresh) token.displayName = fresh.displayName;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.uid as string) ?? "";
        session.user.name = (token.displayName as string) ?? session.user.name;
      }
      session.sid = token.sid as string | undefined;
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sid = token?.sid as string | undefined;
      if (sid) {
        await prisma.session.deleteMany({ where: { sessionToken: sid } }).catch(() => undefined);
      }
    },
  },
});
