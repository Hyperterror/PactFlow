"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, buttonClass, Field, selectClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { useServerRefresh } from "@/lib/use-server-refresh";

export interface InvitableBrief {
  id: string;
  title: string;
  status: string;
}

/**
 * Requirement 22.4/22.5 — the repeat invitation reuses the standard invitation
 * flow and additionally carries the pair's most recent Collaboration Summary, or
 * the history entry itself when no summary has ever been generated. The
 * attachment only becomes readable to the Freelancer after they accept.
 */
export function RepeatInvite({
  freelancerId,
  counterpartName,
  briefs,
}: {
  freelancerId: string;
  counterpartName: string;
  briefs: InvitableBrief[];
}) {
  const refresh = useServerRefresh();
  const [briefId, setBriefId] = useState(briefs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function invite() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<{
        invitation: { id: string };
        attachedSummaryId: string | null;
        attachedHistoryId: string | null;
      }>("/api/invitations/repeat", {
        method: "POST",
        body: JSON.stringify({ briefId, freelancerId }),
      });

      setNotice(
        data.attachedSummaryId
          ? `Invitation sent to ${counterpartName} with your latest collaboration summary attached.`
          : `Invitation sent to ${counterpartName} with the collaboration history attached — no summary has been generated yet.`,
      );
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  }

  if (briefs.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-muted">
          A repeat invitation needs an open brief to point at. Create one first — you can start it from a
          template of this project.
        </p>
        <Link href="/briefs/new" className={buttonClass("secondary", "sm")}>
          Create a brief
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Field
        label="Brief to invite on"
        htmlFor="repeat-brief"
        hint={`Only your own unpublished or open briefs are listed. ${counterpartName} sees the attachment after accepting.`}
      >
        <select
          id="repeat-brief"
          className={selectClass}
          value={briefId}
          onChange={(event) => setBriefId(event.target.value)}
        >
          {briefs.map((brief) => (
            <option key={brief.id} value={brief.id}>
              {brief.title} ({brief.status})
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        className={buttonClass("primary", "md")}
        onClick={() => void invite()}
        disabled={busy || !briefId}
      >
        {busy ? "Sending…" : `Invite ${counterpartName} again`}
      </button>
    </div>
  );
}
