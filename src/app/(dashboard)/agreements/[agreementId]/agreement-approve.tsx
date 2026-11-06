"use client";

import { useState } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { useServerRefresh } from "@/lib/use-server-refresh";
import { formatMoney } from "@/lib/format";

/**
 * Requirement 9.5 — a party approves its own side of the current version, and
 * only a second approval flips the agreement to ACTIVE. Nothing here bypasses
 * that: the endpoint enforces both.
 *
 * Approval is the highest-stakes click in the product, so it states what it is
 * binding the party to before the button is pressed, not after. Two-option
 * confirmation is deliberately avoided: the summary is always visible, and the
 * button names the version it applies to.
 */
export function AgreementApprove({
  agreementId,
  versionNumber,
  viewerRole,
  clientApproved,
  freelancerApproved,
  canApprove,
  total,
  currency,
  milestoneCount,
  revisionLimit,
}: {
  agreementId: string;
  versionNumber: number;
  viewerRole: "CLIENT" | "FREELANCER";
  clientApproved: boolean;
  freelancerApproved: boolean;
  canApprove: boolean;
  total: number;
  currency: string;
  milestoneCount: number;
  revisionLimit: number;
}) {
  const refresh = useServerRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/agreements/${agreementId}/approve`, { method: "POST" });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  }

  const youApproved = viewerRole === "CLIENT" ? clientApproved : freelancerApproved;
  const otherApproved = viewerRole === "CLIENT" ? freelancerApproved : clientApproved;
  const showSummary = canApprove && !youApproved;

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <ul className="space-y-2 text-sm">
        <li className="flex items-center justify-between gap-3">
          <span className="text-muted">You ({viewerRole === "CLIENT" ? "Client" : "Freelancer"})</span>
          <span className={youApproved ? "font-medium text-success" : "font-medium text-warning"}>
            {youApproved ? "Approved" : "Pending"}
          </span>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="text-muted">
            {viewerRole === "CLIENT" ? "Freelancer" : "Client"}
          </span>
          <span className={otherApproved ? "font-medium text-success" : "font-medium text-warning"}>
            {otherApproved ? "Approved" : "Pending"}
          </span>
        </li>
      </ul>

      {showSummary ? (
        <div className="rounded-lg border border-brass/40 bg-brass-soft px-3 py-3">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-brass-strong uppercase">
            What version {versionNumber} commits you to
          </p>
          <dl className="mt-2 space-y-1.5 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Total price</dt>
              <dd className="tabular font-semibold text-foreground">{formatMoney(total, currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Milestones gated on your approval</dt>
              <dd className="tabular font-medium text-foreground">{milestoneCount}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted">Revisions included</dt>
              <dd className="tabular font-medium text-foreground">{revisionLimit} per deliverable</dd>
            </div>
          </dl>
          <p className="mt-2.5 text-xs leading-relaxed text-muted">
            Approving does not start delivery. It becomes the binding version only when{" "}
            {viewerRole === "CLIENT" ? "the Freelancer" : "the Client"} approves this same version too. Later
            versions never rewrite this one.
          </p>
        </div>
      ) : null}

      {showSummary ? (
        <button
          type="button"
          className={buttonClass("primary", "md", "w-full")}
          onClick={() => void approve()}
          disabled={busy}
        >
          {busy ? "Approving…" : `Approve version ${versionNumber}`}
        </button>
      ) : youApproved ? (
        <p className="text-xs leading-relaxed text-muted">
          You approved this version. The agreement becomes active once the other party approves too.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted">This version is not open for approval.</p>
      )}
    </div>
  );
}
