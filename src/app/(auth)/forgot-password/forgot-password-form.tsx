"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";

/**
 * The response is deliberately identical for known and unknown addresses, so
 * the UI cannot be used to test whether an account exists. In development the
 * API also returns a usable link, which is shown here as a convenience.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    setDevResetUrl(null);

    try {
      const result = await apiRequest<{ message: string; devResetUrl?: string }>(
        "/api/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email: email.trim() }) },
      );
      setMessage(result.message);
      setDevResetUrl(result.devResetUrl ?? null);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {message ? (
        <Alert tone="success" title="Check your inbox">
          {message}
        </Alert>
      ) : null}
      {devResetUrl ? (
        <Alert tone="info" title="Development shortcut">
          No mail transport is configured, so use this link directly:{" "}
          <Link href={devResetUrl} className="font-semibold underline underline-offset-4">
            open reset link
          </Link>
        </Alert>
      ) : null}

      <Field label="Email" htmlFor="email" hint="The address you registered with." required>
        <input
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

      <button type="submit" className={buttonClass("primary", "md", "w-full")} disabled={pending}>
        {pending ? "Creating link…" : "Create reset link"}
      </button>
    </form>
  );
}
