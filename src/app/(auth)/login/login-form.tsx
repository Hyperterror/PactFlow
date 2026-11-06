"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui";

/**
 * Requirement 1.5 — the form never distinguishes "no such account" from "wrong
 * password". The only distinct message is the lockout, which the user must be
 * told about because waiting is the only remedy.
 */
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
        callbackUrl,
      });

      const code = (result as { code?: string } | undefined)?.code ?? "";
      if (result?.error) {
        setError(
          code === "account_locked"
            ? "This account is temporarily locked after repeated failed attempts. Try again later."
            : "Those credentials are not valid.",
        );
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Unable to sign in right now. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1.5 text-sm text-muted">Continue to your briefs, agreements and deliveries.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field label="Email" htmlFor="email" required>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@studio.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={200}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </Field>

        <button type="submit" className={buttonClass("primary", "md", "w-full")} disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-sm text-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
