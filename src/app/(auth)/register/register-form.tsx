"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Alert, buttonClass, Field, inputClass } from "@/components/ui";
import { ApiRequestError, apiRequest, errorMessage } from "@/lib/api-client";

/**
 * Requirement 1.1/1.2 — registration collects the three required values, keeps
 * the email within 254 characters and the display name within 100, and surfaces
 * the duplicate-email rejection on the `email` field.
 */
export function RegisterForm() {
  const router = useRouter();
  const [values, setValues] = useState({ email: "", displayName: "", password: "", confirm: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof typeof values>(key: K, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (values.password !== values.confirm) {
      setFieldErrors({ confirm: "Passwords do not match." });
      return;
    }
    setFieldErrors({});
    setPending(true);

    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: values.email.trim(),
          displayName: values.displayName.trim(),
          password: values.password,
        }),
      });

      const result = await signIn("credentials", {
        email: values.email.trim(),
        password: values.password,
        redirect: false,
      });
      if (result?.error) {
        router.push("/login");
        return;
      }

      router.push("/briefs");
      router.refresh();
    } catch (thrown) {
      if (thrown instanceof ApiRequestError) {
        setFieldErrors(thrown.fieldMap());
        setError(thrown.fields.length === 0 ? thrown.message : null);
      } else {
        setError(errorMessage(thrown));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        One account works for both sides — post a brief, or bid on one.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Field label="Display name" htmlFor="displayName" required error={fieldErrors.displayName}>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            maxLength={100}
            required
            value={values.displayName}
            onChange={(event) => set("displayName", event.target.value)}
            className={inputClass}
            placeholder="Ada Studio"
          />
        </Field>

        <Field
          label="Email"
          htmlFor="email"
          required
          error={fieldErrors.email}
          hint="Up to 254 characters."
        >
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            value={values.email}
            onChange={(event) => set("email", event.target.value)}
            className={inputClass}
            placeholder="you@studio.com"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          error={fieldErrors.password}
          hint="At least 8 characters."
        >
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={200}
            required
            value={values.password}
            onChange={(event) => set("password", event.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </Field>

        <Field label="Confirm password" htmlFor="confirm" required error={fieldErrors.confirm}>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={200}
            required
            value={values.confirm}
            onChange={(event) => set("confirm", event.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
        </Field>

        <button type="submit" className={buttonClass("primary", "md", "w-full")} disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-5 text-sm text-muted">
        Already registered?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
