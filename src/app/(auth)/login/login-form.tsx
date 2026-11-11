"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Alert, buttonClass, Field, inputClass, selectClass } from "@/components/ui";

// Public demo credentials from prisma/seed.ts, offered for hackathon judging.
const DEMO_PASSWORD = "Password123!";
const DEMO_ACCOUNTS = [
  { email: "client@pactflow.dev", label: "Client — Northwind Studio" },
  { email: "freelancer@pactflow.dev", label: "Freelancer — Ada Lovelace" },
  { email: "grace@pactflow.dev", label: "Freelancer — Grace Hopper" },
] as const;

/**
 * Requirement 1.5 — the form never distinguishes "no such account" from "wrong
 * password". The only distinct message is the lockout, which the user must be
 * told about because waiting is the only remedy.
 */
export function LoginForm({ callbackUrl, justReset = false }: { callbackUrl: string; justReset?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const demoAccount = password === DEMO_PASSWORD
    ? DEMO_ACCOUNTS.find((account) => account.email === email)?.email ?? ""
    : "";

  function selectDemoAccount(value: string) {
    const account = DEMO_ACCOUNTS.find((account) => account.email === value);
    setEmail(account?.email ?? "");
    setPassword(account ? DEMO_PASSWORD : "");
    setError(null);
  }

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
        // Put the caret where the fix has to happen rather than leaving the
        // keyboard focus stranded on the submit button.
        emailRef.current?.focus();
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
        {justReset && !error ? (
          <Alert tone="success">Password updated. Sign in with your new password.</Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field
          label="Demo account"
          htmlFor="demo-account"
          className="border-b border-border-base pb-4"
          hint={
            <span id="demo-account-hint">
              Judging PactFlow? Choose an account to fill in the credentials, then sign in.
            </span>
          }
        >
          <select
            id="demo-account"
            value={demoAccount}
            onChange={(event) => selectDemoAccount(event.target.value)}
            disabled={pending}
            aria-describedby="demo-account-hint"
            className={selectClass}
          >
            <option value="">Choose a demo account</option>
            {DEMO_ACCOUNTS.map((account) => (
              <option key={account.email} value={account.email}>
                {account.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Email" htmlFor="email" hint="For example: you@studio.com" required>
          <input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            autoCapitalize="none"
            maxLength={254}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
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
          />
        </Field>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>

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
