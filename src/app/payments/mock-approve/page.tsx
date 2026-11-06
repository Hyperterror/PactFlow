import type { Metadata } from "next";
import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { isMockMode } from "@/lib/payments/paypal-client";
import { Alert, buttonClass } from "@/components/ui";
import { MockApprove } from "./mock-approve";

export const metadata: Metadata = { title: "Mock PayPal approval" };

type Search = { searchParams: Promise<{ token?: string }> };

/**
 * Sandbox-only approve screen. When real PayPal credentials are configured the
 * approve URL points at paypal.com instead, so this page reports that rather
 * than pretending to be a checkout.
 */
export default async function MockApprovePage({ searchParams }: Search) {
  await requirePageSession();
  const { token } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-12">
      {!isMockMode() ? (
        <div className="w-full max-w-md space-y-4">
          <Alert tone="warning" title="Sandbox mode is off">
            Real PayPal credentials are configured, so payments are approved on paypal.com. This local screen is only
            used when no credentials are present.
          </Alert>
          <Link href="/delivery" className={buttonClass("primary", "md")}>
            Back to delivery
          </Link>
        </div>
      ) : !token ? (
        <div className="w-full max-w-md space-y-4">
          <Alert tone="danger" title="Missing order token">
            This page needs the <code className="font-mono">token</code> query parameter that PayPal returns on
            approval.
          </Alert>
          <Link href="/delivery" className={buttonClass("primary", "md")}>
            Back to delivery
          </Link>
        </div>
      ) : (
        <MockApprove token={token} />
      )}
    </main>
  );
}
