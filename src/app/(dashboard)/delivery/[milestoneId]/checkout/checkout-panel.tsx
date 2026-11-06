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
}: {
  milestoneId: string;
  amount: number;
  currency: string;
  milestoneStatus: string;
  payment: { id: string; status: string; approveUrl: string | null; orderId: string | null } | null;
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
  const payable = milestoneStatus === "APPROVED" && !captured;

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
      </div>

      {captured ? (
        <Alert tone="success" title="Payment captured">
          The original deliverable is unlocked. Open the delivery room to download it through a signed link that
          expires.
        </Alert>
      ) : null}

      {!payable && !captured ? (
        <Alert tone="info">
          Payment opens once the Client approves the delivered milestone. Current milestone state:{" "}
          <span className="font-medium">{milestoneStatus.toLowerCase().replaceAll("_", " ")}</span>.
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {payable ? (
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

        {payment && (payment.status === "FAILED" || payment.status === "REVIEW_REQUIRED") ? (
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
        Payments run against PayPal Orders v2. In sandbox mode the approve step is served by the local mock checkout so
        the whole flow stays reproducible without a PayPal account.
      </p>
    </div>
  );
}
