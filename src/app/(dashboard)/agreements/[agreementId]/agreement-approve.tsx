"use client";

import { useState } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Requirement 9.5 — a party approves its own side of the current version, and
 * only a second approval flips the agreement to ACTIVE. Nothing here bypasses
 * that: the endpoint enforces both.
 */
export function AgreementApprove({
  agreementId,
  versionNumber,
  viewerRole,
  clientApproved,
  freelancerApproved,
  canApprove,
}: {
  agreementId: string;
  versionNumber: number;
  viewerRole: "CLIENT" | "FREELANCER";
  clientApproved: boolean;
  freelancerApproved: boolean;
  canApprove: boolean;
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

      {canApprove && !youApproved ? (
        <button type="button" className={buttonClass("primary", "md", "w-full")} onClick={() => void approve()} disabled={busy}>
          {busy ? "Approving…" : `Approve version ${versionNumber}`}
        </button>
      ) : (
        <p className="text-xs text-muted">
          {youApproved
            ? "You approved this version. The agreement becomes active once the other party approves too."
            : "This version is not open for approval."}
        </p>
      )}
    </div>
  );
}
