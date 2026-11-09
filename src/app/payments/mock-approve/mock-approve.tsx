"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, buttonClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { navigateAfterMutation } from "@/lib/use-server-refresh";

/**
 * Local stand-in for PayPal's approve screen (sandbox only).
 *
 * The Client lands here from `approveUrl`, confirms, and the capture endpoint —
 * not this page — decides whether the payment is captured, flagged for review or
 * failed. Nothing about the resulting state is decided client-side.
 */
export function MockApprove({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy("approve");
    setError(null);
    try {
      const data = await apiRequest<{ payment: { milestoneId: string }; captured: boolean; reviewRequired: boolean }>(
        "/api/payments/capture",
        { method: "POST", body: JSON.stringify({ paypalOrderId: token }) },
      );
      navigateAfterMutation(`/delivery/${data.payment.milestoneId}`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-md space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="rounded-card border border-border-base bg-surface p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight text-[#003087]">PayPal checkout simulator</span>
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">Mock mode</span>
        </div>

        <p className="mt-6 text-sm text-muted">
          This is PactFlow&apos;s local stand-in for PayPal, used when no Sandbox credentials are configured. It
          returns Orders v2-shaped responses, and the backend still verifies the capture amount and currency
          before releasing the file. Set PAYPAL_MODE=sandbox to use real PayPal Sandbox checkout.
        </p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Order</dt>
            <dd className="font-mono text-xs">{token}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Intent</dt>
            <dd className="font-medium">CAPTURE</dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            className={buttonClass("primary", "lg", "w-full")}
            onClick={() => void approve()}
            disabled={busy !== null}
          >
            {busy === "approve" ? "Confirming…" : "Approve payment"}
          </button>
          <button
            type="button"
            className={buttonClass("ghost", "md", "w-full")}
            onClick={() => router.push("/delivery")}
            disabled={busy !== null}
          >
            Cancel and return
          </button>
        </div>
      </div>

      <p className="text-center text-xs text-muted">
        The original deliverable is released only when the capture is confirmed server-side.
      </p>
    </div>
  );
}
