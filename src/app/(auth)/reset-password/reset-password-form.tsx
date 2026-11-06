"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";

/**
 * A successful reset ends with a redirect to sign-in rather than an inline
 * "done" message: the user's sessions were revoked, so the next step really is
 * authenticating again, and the form should say so by taking them there.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mismatch) return;

    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      router.push("/login?reset=1");
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title="Password updated">
        Your sessions were signed out.{" "}
        <Link href="/login" className="font-semibold underline underline-offset-4">
          Sign in with the new password
        </Link>
        .
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field
        label="New password"
        htmlFor="password"
        hint="At least 8 characters."
        error={mismatch ? "The two passwords do not match." : undefined}
        required
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="Confirm password" htmlFor="confirm" required>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={inputClass}
          aria-invalid={mismatch || undefined}
        />
      </Field>

      <button
        type="submit"
        className={buttonClass("primary", "md", "w-full")}
        disabled={pending || mismatch || password.length < 8}
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
