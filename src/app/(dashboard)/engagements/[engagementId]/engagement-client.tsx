"use client";

import { useState, type FormEvent } from "react";
import { Alert, buttonClass, Field, inputClass, selectClass, textareaClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useServerRefresh } from "@/lib/use-server-refresh";
import { cn } from "@/lib/cn";

export interface ThreadMessage {
  id: string;
  content: string;
  createdAt: string;
  authorRole: "CLIENT" | "FREELANCER";
  authorName: string;
}

/** Discovery discussion. It lives on the Engagement, so no Agreement is needed to talk. */
export function DiscoveryThread({
  engagementId,
  messages,
  viewerRole,
  canPost,
}: {
  engagementId: string;
  messages: ThreadMessage[];
  viewerRole: "CLIENT" | "FREELANCER";
  canPost: boolean;
}) {
  const refresh = useServerRefresh();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: draft }),
      });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <p className="text-sm text-muted">
          No messages yet. Use this thread to clarify users, workflows, constraints and what “done” means. The AI draft
          can cite these messages as sources.
        </p>
      ) : (
        <ol className="space-y-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cn(
                "rounded-lg border border-border-base px-3 py-2",
                message.authorRole === viewerRole ? "bg-surface-muted" : "bg-surface",
              )}
            >
              <p className="text-xs text-muted">
                <span className="font-semibold text-foreground">{message.authorName}</span> ·{" "}
                {message.authorRole === "CLIENT" ? "Client" : "Freelancer"} · {formatDateTime(message.createdAt)}
              </p>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
            </li>
          ))}
        </ol>
      )}

      {canPost ? (
        <form onSubmit={(event) => void submit(event)} className="space-y-2">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="New message" htmlFor="discovery-message">
            <textarea
              id="discovery-message"
              className={textareaClass}
              value={draft}
              maxLength={5000}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="e.g. The pricing page must support monthly and annual plans."
            />
          </Field>
          <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || !draft.trim()}>
            {busy ? "Posting…" : "Post message"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** Discovery is never silently unlimited unpaid work: the parties record the arrangement. */
export function DiscoveryTermsForm({
  engagementId,
  initial,
  editable,
}: {
  engagementId: string;
  initial: { discoveryType: string; discoveryDays: number | null; discoveryFee: number | null; discoveryNotes: string | null };
  editable: boolean;
}) {
  const refresh = useServerRefresh();
  const [type, setType] = useState(initial.discoveryType);
  const [days, setDays] = useState(initial.discoveryDays?.toString() ?? "");
  const [fee, setFee] = useState(initial.discoveryFee?.toString() ?? "");
  const [notes, setNotes] = useState(initial.discoveryNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/terms`, {
        method: "POST",
        body: JSON.stringify({
          discoveryType: type,
          discoveryDays: type === "UNPAID" || !days ? null : Number(days),
          discoveryFee: type === "PAID" && fee ? Number(fee) : null,
          discoveryNotes: notes || null,
        }),
      });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Discovery arrangement" htmlFor="discovery-type">
        <select
          id="discovery-type"
          className={selectClass}
          value={type}
          disabled={!editable}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="UNPAID">Unpaid</option>
          <option value="TIME_BOXED">Unpaid, time-boxed</option>
          <option value="PAID">Paid discovery phase</option>
        </select>
      </Field>
      {type !== "UNPAID" ? (
        <Field label="Length (days)" htmlFor="discovery-days">
          <input
            id="discovery-days"
            type="number"
            min={1}
            max={365}
            className={inputClass}
            value={days}
            disabled={!editable}
            onChange={(event) => setDays(event.target.value)}
          />
        </Field>
      ) : null}
      {type === "PAID" ? (
        <Field label="Fee (USD)" htmlFor="discovery-fee" hint="Recorded for the record only — it is not charged through PactFlow.">
          <input
            id="discovery-fee"
            type="number"
            min={0.01}
            step="0.01"
            className={inputClass}
            value={fee}
            disabled={!editable}
            onChange={(event) => setFee(event.target.value)}
          />
        </Field>
      ) : null}
      <Field label={type === "PAID" ? "Expected output" : "Notes"} htmlFor="discovery-notes">
        <textarea
          id="discovery-notes"
          className={textareaClass}
          value={notes}
          maxLength={2000}
          disabled={!editable}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
      {editable ? (
        <button type="submit" className={buttonClass("secondary", "sm")} disabled={busy}>
          {busy ? "Saving…" : "Save terms"}
        </button>
      ) : (
        <p className="text-xs text-muted">Terms are locked once the requirements are approved.</p>
      )}
    </form>
  );
}

export function CancelEngagement({ engagementId }: { engagementId: string }) {
  const refresh = useServerRefresh();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/engagements/${engagementId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(true)}>
        Cancel engagement
      </button>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field
        label="Reason for cancelling"
        htmlFor="cancel-reason"
        hint="The proposal, messages and requirement versions are kept. The Client can then select another proposal."
      >
        <textarea
          id="cancel-reason"
          className={textareaClass}
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("danger", "sm")} disabled={busy || !reason.trim()}>
          {busy ? "Cancelling…" : "Confirm cancellation"}
        </button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)} disabled={busy}>
          Keep engagement
        </button>
      </div>
    </form>
  );
}
