"use client";

import { useState, type FormEvent } from "react";
import { Alert, Badge, buttonClass, Field, selectClass, textareaClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useServerRefresh } from "@/lib/use-server-refresh";

/**
 * Approval of one exact version. The request names the version on screen, so a
 * newer save can never be approved from a stale page; the server re-checks
 * blockers and both approvals.
 */
export function RequirementsApproval({
  engagementId,
  versionNumber,
  viewerRole,
  clientApproved,
  freelancerApproved,
  blockers,
  open,
}: {
  engagementId: string;
  versionNumber: number;
  viewerRole: "CLIENT" | "FREELANCER";
  clientApproved: boolean;
  freelancerApproved: boolean;
  blockers: string[];
  open: boolean;
}) {
  const refresh = useServerRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const youApproved = viewerRole === "CLIENT" ? clientApproved : freelancerApproved;
  const otherApproved = viewerRole === "CLIENT" ? freelancerApproved : clientApproved;

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/requirements/approve`, {
        method: "POST",
        body: JSON.stringify({ versionNumber }),
      });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(false);
    }
  }

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
          <span className="text-muted">{viewerRole === "CLIENT" ? "Freelancer" : "Client"}</span>
          <span className={otherApproved ? "font-medium text-success" : "font-medium text-warning"}>
            {otherApproved ? "Approved" : "Pending"}
          </span>
        </li>
      </ul>

      {blockers.length > 0 ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5">
          <p className="text-xs font-semibold text-warning">Approval is blocked until a revision resolves:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {blockers.map((blocker, index) => (
              <li key={index}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {open && !youApproved ? (
        <button
          type="button"
          className={buttonClass("primary", "md", "w-full")}
          onClick={() => void approve()}
          disabled={busy || blockers.length > 0}
        >
          {busy ? "Approving…" : `Approve requirements v${versionNumber}`}
        </button>
      ) : youApproved && !otherApproved ? (
        <p className="text-xs leading-relaxed text-muted">
          You approved version {versionNumber}. It becomes the baseline once the other party approves this same version.
        </p>
      ) : youApproved && otherApproved ? (
        <p className="text-xs leading-relaxed text-success">Both parties approved version {versionNumber}.</p>
      ) : null}
      <p className="text-xs leading-relaxed text-muted">
        Any later edit creates a new version, and approvals never carry over to it.
      </p>
    </div>
  );
}

export interface ReviewComment {
  id: string;
  versionNumber: number;
  requirementId: string | null;
  body: string;
  status: string;
  createdAt: string;
  authorName: string;
  authorRole: "CLIENT" | "FREELANCER";
}

export function RequirementsComments({
  engagementId,
  versionNumber,
  itemIds,
  comments,
  canComment,
}: {
  engagementId: string;
  versionNumber: number;
  itemIds: string[];
  comments: ReviewComment[];
  canComment: boolean;
}) {
  const refresh = useServerRefresh();
  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(event: FormEvent) {
    event.preventDefault();
    setBusy("post");
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/requirements/comments`, {
        method: "POST",
        body: JSON.stringify({ versionNumber, requirementId: anchor || null, body }),
      });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  async function resolve(commentId: string) {
    setBusy(commentId);
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/requirements/comments/${commentId}/resolve`, { method: "POST" });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ol className="space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-lg border border-border-base px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-semibold text-foreground">{comment.authorName}</span>
                <span>{comment.authorRole === "CLIENT" ? "Client" : "Freelancer"}</span>
                <span>v{comment.versionNumber}</span>
                {comment.requirementId ? <Badge tone="neutral">{comment.requirementId}</Badge> : null}
                <Badge tone={comment.status === "OPEN" ? "warning" : "success"}>
                  {comment.status === "OPEN" ? "Open" : "Resolved"}
                </Badge>
                <span>{formatDateTime(comment.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{comment.body}</p>
              {comment.status === "OPEN" && canComment ? (
                <button
                  type="button"
                  className={buttonClass("ghost", "sm", "mt-1")}
                  onClick={() => void resolve(comment.id)}
                  disabled={busy !== null}
                >
                  {busy === comment.id ? "Resolving…" : "Mark resolved"}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {canComment ? (
        <form onSubmit={(event) => void post(event)} className="space-y-2">
          <Field label="Comment on" htmlFor="comment-anchor">
            <select id="comment-anchor" className={selectClass} value={anchor} onChange={(event) => setAnchor(event.target.value)}>
              <option value="">Version {versionNumber} as a whole</option>
              {itemIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Comment" htmlFor="comment-body">
            <textarea
              id="comment-body"
              className={textareaClass}
              value={body}
              maxLength={2000}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <button type="submit" className={buttonClass("secondary", "sm")} disabled={busy !== null || !body.trim()}>
            {busy === "post" ? "Posting…" : "Post comment"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
