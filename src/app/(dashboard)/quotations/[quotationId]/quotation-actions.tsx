"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, buttonClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { humanize } from "@/lib/format";
import { navigateAfterMutation, useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Quotation lifecycle actions. Every button maps to one explicit endpoint, and
 * the backend decides whether the transition is legal (Requirements 6.3, 6.6,
 * 8.10) — the UI only hides what is obviously not applicable.
 */
export function QuotationActions({
  quotationId,
  briefId,
  status,
  viewerRole,
}: {
  quotationId: string;
  briefId: string;
  status: string;
  viewerRole: "CLIENT" | "FREELANCER";
}) {
  const refresh = useServerRefresh();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draftable = status === "AI_DRAFT" || status === "DRAFT";
  const submitted = status === "SUBMITTED" || status === "UNDER_REVIEW";
  const withdrawable = draftable || submitted || status === "SHORTLISTED";
  const acceptable = submitted || status === "SHORTLISTED";

  async function run(label: string, path: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      const data = await apiRequest<{ agreementId?: string }>(path, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (data.agreementId) {
        navigateAfterMutation(`/agreements/${data.agreementId}`);
        return;
      }
      refresh();
      setBusy(null);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2">
        {viewerRole === "FREELANCER" && draftable ? (
          <>
            <Link href={`/quotations/${quotationId}/edit`} className={buttonClass("secondary", "md")}>
              Edit draft
            </Link>
            <button
              type="button"
              className={buttonClass("primary", "md")}
              disabled={busy !== null}
              onClick={() => void run("submit", `/api/quotations/${quotationId}/submit`)}
            >
              {busy === "submit" ? "Submitting…" : "Submit quotation"}
            </button>
          </>
        ) : null}

        {viewerRole === "CLIENT" && submitted ? (
          <button
            type="button"
            className={buttonClass("secondary", "md")}
            disabled={busy !== null}
            onClick={() => void run("shortlist", `/api/quotations/${quotationId}/shortlist`)}
          >
            {busy === "shortlist" ? "Shortlisting…" : "Shortlist"}
          </button>
        ) : null}

        {viewerRole === "CLIENT" && acceptable ? (
          <button
            type="button"
            className={buttonClass("primary", "md")}
            disabled={busy !== null}
            onClick={() => void run("accept", `/api/briefs/${briefId}/comparison/accept`, { quotationId })}
          >
            {busy === "accept" ? "Accepting…" : "Accept quotation"}
          </button>
        ) : null}

        {viewerRole === "CLIENT" ? (
          <Link href={`/briefs/${briefId}/compare`} className={buttonClass("ghost", "md")}>
            Compare quotations
          </Link>
        ) : null}

        {withdrawable ? (
          <button
            type="button"
            className={buttonClass("ghost", "md")}
            disabled={busy !== null}
            onClick={() => void run("withdraw", `/api/quotations/${quotationId}/withdraw`)}
          >
            {busy === "withdraw" ? "Withdrawing…" : draftable ? "Discard draft" : "Withdraw"}
          </button>
        ) : null}

        <Link href={`/briefs/${briefId}`} className={buttonClass("ghost", "md")}>
          Brief
        </Link>
      </div>

      <p className="text-xs text-muted">
        Current state: <span className="font-medium text-foreground">{humanize(status)}</span>. Accepting creates the
        agreement — nothing is payable until delivery is approved.
      </p>
    </div>
  );
}
