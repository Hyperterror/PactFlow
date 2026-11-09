"use client";

import { useState } from "react";
import { Alert, Badge, buttonClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Requirement 16.5 — the checkout hands the Client to PayPal's approve URL and
 * reports where the payment actually stands. Nothing here can mark a payment
 * captured; only the capture endpoint (or its webhook) does that.
 */
export function CheckoutPanel({
  milestoneId,
  amount,
  currency,
  milestoneStatus,
  payment,
  mockMode,
}: {
  milestoneId: string;
  amount: number;
  currency: string;
  milestoneStatus: string;
  payment: {
    id: string;
    status: string;
    approveUrl: string | null;
    orderId: string | null;
    captureId: string | null;
  } | null;
  mockMode: boolean;
}) {
  const refresh = useServerRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, path: string, body: unknown) {
    setBusy(label);
    setError(null);
    try {
      const data = await apiRequest<{ approveUrl?: string | null }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (data.approveUrl) {
        window.location.href = data.approveUrl;
        return;
      }
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  const captured = payment?.status === "CAPTURED";
  // PayPal accepted the capture but has not settled it; the webhook finishes it.
  const settling = payment?.status === "PENDING" && Boolean(payment.captureId);
  const payable = milestoneStatus === "APPROVED" && !captured && !settling;

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="rounded-card border border-border-base bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Amount due</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{formatMoney(amount, currency)}</p>
          </div>
          <Badge tone={captured ? "success" : payment ? "warning" : "neutral"}>
            {captured ? "Paid" : payment ? payment.status.toLowerCase().replaceAll("_", " ") : "Not started"}
          </Badge>
        </div>

        {payment?.orderId ? (
          <p className="mt-3 font-mono text-xs text-muted">Order {payment.orderId}</p>
        ) : null}
        {payment?.captureId ? (
          <p className="mt-1 font-mono text-xs text-muted">Capture {payment.captureId}</p>
        ) : null}
      </div>

      {captured ? (
        <Alert tone="success" title="Payment captured">
          The original deliverable is unlocked. Open the delivery room to download it through a signed link that
          expires.
        </Alert>
      ) : null}

      {settling ? (
        <Alert tone="warning" title="PayPal is settling this payment">
          The capture was accepted but is still pending at PayPal. The file unlocks automatically once PayPal confirms
          it.
        </Alert>
      ) : null}

      {payment?.status === "FAILED" ? (
        <Alert tone="danger" title="Payment declined">
          PayPal declined the last attempt and nothing was charged. Pay again to choose another funding source.
        </Alert>
      ) : null}

      {payment?.status === "REVIEW_REQUIRED" ? (
        <Alert tone="warning" title="Held for review">
          The captured amount or currency did not match the agreement, so the file stays locked until an operator
          resolves it.
        </Alert>
      ) : null}

      {!payable && !captured && !settling ? (
        <Alert tone="info">
          Payment opens once the Client approves the delivered milestone. Current milestone state:{" "}
          <span className="font-medium">{milestoneStatus.toLowerCase().replaceAll("_", " ")}</span>.
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {payable && payment?.status !== "REVIEW_REQUIRED" ? (
          <button
            type="button"
            className={buttonClass("primary", "md")}
            onClick={() => void run("pay", "/api/payments", { milestoneId })}
            disabled={busy !== null}
          >
            {busy === "pay"
              ? "Opening PayPal…"
              : payment?.status === "PENDING"
                ? "Continue to PayPal"
                : "Pay with PayPal"}
          </button>
        ) : null}

        {payment?.status === "REVIEW_REQUIRED" ? (
          <button
            type="button"
            className={buttonClass("secondary", "md")}
            onClick={() => void run("retry", "/api/payments/retry", { paymentId: payment.id })}
            disabled={busy !== null}
          >
            {busy === "retry" ? "Retrying…" : "Retry capture"}
          </button>
        ) : null}

        <a href={`/delivery/${milestoneId}`} className={buttonClass("ghost", "md")}>
          Back to delivery room
        </a>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {mockMode
          ? "Mock mode: the approve step is served by a local stand-in for PayPal so the flow runs without an account. Set PAYPAL_MODE=sandbox with credentials to use PayPal Sandbox."
          : "Payments run against the PayPal Orders v2 Sandbox. You approve on PayPal, return here, and the capture is confirmed server-side before the file unlocks."}
      </p>
    </div>
  );
}
