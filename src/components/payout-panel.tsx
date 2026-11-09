"use client";

import { useState, type FormEvent } from "react";
import { Alert, Badge, buttonClass, Field, inputClass, KeyValue } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Where the Freelancer is paid. Saving it also releases any payout that was
 * waiting for an address.
 */
export function PayoutAccountForm({ initialEmail }: { initialEmail: string | null }) {
  const refresh = useServerRefresh();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/payouts/account", {
        method: "POST",
        body: JSON.stringify({ paypalPayoutEmail: email }),
      });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label="PayPal payout email"
        htmlFor="paypal-payout-email"
        hint="Milestone payments are sent here with PayPal Payouts once the Client's payment is verified."
      >
        <input
          id="paypal-payout-email"
          type="email"
          className={inputClass}
          value={email}
          maxLength={254}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </Field>
      <button type="submit" className={buttonClass("secondary", "sm")} disabled={busy || !email.trim()}>
        {busy ? "Saving…" : initialEmail ? "Update payout email" : "Save payout email"}
      </button>
    </form>
  );
}

export interface PayoutView {
  id: string;
  status: string;
  grossAmount: number;
  platformFee: number;
  amount: number;
  currency: string;
  paypalBatchId: string | null;
  paypalItemId: string | null;
  paypalStatus: string | null;
  lastError: string | null;
  completedAt: string | null;
}

const STATUS_COPY: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  AWAITING_RECEIVER: { label: "Waiting for payout email", tone: "warning" },
  PENDING: { label: "Sent — PayPal processing", tone: "info" },
  SUCCEEDED: { label: "Paid to Freelancer", tone: "success" },
  UNCLAIMED: { label: "Unclaimed at PayPal", tone: "warning" },
  FAILED: { label: "Payout failed", tone: "danger" },
};

/** The Freelancer's share of a captured payment, as PayPal Payouts reports it. */
export function PayoutStatusPanel({
  payout,
  viewerRole,
  hasPayoutEmail,
  mockMode,
}: {
  payout: PayoutView;
  viewerRole: "CLIENT" | "FREELANCER";
  hasPayoutEmail: boolean;
  mockMode: boolean;
}) {
  const refresh = useServerRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = STATUS_COPY[payout.status] ?? { label: payout.status, tone: "info" as const };

  async function run(action: "refresh" | "retry") {
    setBusy(action);
    setError(null);
    try {
      await apiRequest(`/api/payouts/${payout.id}/${action}`, { method: "POST" });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <KeyValue label="Status">
        <Badge tone={copy.tone}>{copy.label}</Badge>
      </KeyValue>
      <KeyValue label="Captured from Client">{formatMoney(payout.grossAmount, payout.currency)}</KeyValue>
      <KeyValue label="Platform fee">{formatMoney(payout.platformFee, payout.currency)}</KeyValue>
      <KeyValue label="To Freelancer">
        <span className="font-semibold">{formatMoney(payout.amount, payout.currency)}</span>
      </KeyValue>
      {payout.paypalItemId ? (
        <KeyValue label="PayPal payout item">
          <span className="font-mono text-xs">{payout.paypalItemId}</span>
        </KeyValue>
      ) : null}
      {payout.completedAt ? <KeyValue label="Paid at">{formatDateTime(payout.completedAt)}</KeyValue> : null}
      {payout.lastError && payout.status !== "SUCCEEDED" ? (
        <p className="text-xs leading-relaxed text-muted">{payout.lastError}</p>
      ) : null}
      {payout.status === "UNCLAIMED" ? (
        <p className="text-xs leading-relaxed text-muted">
          PayPal holds unclaimed payouts until the receiver signs up with this email; after 30 days they return to
          the platform.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {payout.paypalBatchId && (payout.status === "PENDING" || payout.status === "UNCLAIMED") ? (
          <button type="button" className={buttonClass("secondary", "sm")} disabled={busy !== null} onClick={() => void run("refresh")}>
            {busy === "refresh" ? "Checking…" : "Check status with PayPal"}
          </button>
        ) : null}
        {viewerRole === "FREELANCER" && payout.status === "FAILED" && hasPayoutEmail ? (
          <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={() => void run("retry")}>
            {busy === "retry" ? "Retrying…" : "Retry payout"}
          </button>
        ) : null}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        {mockMode
          ? "Mock mode: the Payouts call is simulated locally. Set PAYPAL_MODE=sandbox to send a real Sandbox payout."
          : "Sent with the PayPal Payouts API from the platform's PayPal account."}
      </p>
    </div>
  );
}
