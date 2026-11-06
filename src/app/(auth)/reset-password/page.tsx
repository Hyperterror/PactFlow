import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

type Props = { searchParams: Promise<{ token?: string }> };

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Link incomplete</h1>
        <p className="mt-1.5 text-sm text-muted">
          This page needs a reset token. Open the link you were given, or request a new one.
        </p>
        <div className="mt-6">
          <Alert tone="warning" title="No token supplied">
            Reset links are single use and expire after one hour.
          </Alert>
        </div>
        <p className="mt-5 text-sm text-muted">
          <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-1.5 text-sm text-muted">
        Choosing a new password signs you out everywhere and clears any lockout on the account.
      </p>

      <div className="mt-6">
        <ResetPasswordForm token={token} />
      </div>

      <p className="mt-5 text-sm text-muted">
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
