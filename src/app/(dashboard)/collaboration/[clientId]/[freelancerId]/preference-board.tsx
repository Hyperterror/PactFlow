"use client";

import { useState } from "react";
import { Alert, Badge, buttonClass, EmptyState, Field, selectClass, textareaClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useServerRefresh } from "@/lib/use-server-refresh";

export interface BoardPreference {
  id: string;
  historyId: string;
  statement: string;
  authorRole: "CLIENT" | "FREELANCER";
  authorId: string;
  acknowledgedAt: string | null;
  createdAt?: string | null;
}

export interface HistoryOption {
  id: string;
  label: string;
}

/**
 * Requirements 20.4-20.7 — a statement is authored by one party and only becomes
 * CONFIRMED when the other party acknowledges it. A CONFIRMED statement can never
 * be edited in place: amending submits a new statement that resets both parties to
 * PENDING_ACKNOWLEDGEMENT. The endpoints enforce all of this; the UI only offers
 * the actions that are legal for the viewer.
 */
export function PreferenceBoard({
  viewerId,
  counterpartName,
  historyOptions,
  confirmed,
  pending,
}: {
  viewerId: string;
  counterpartName: string;
  historyOptions: HistoryOption[];
  confirmed: BoardPreference[];
  pending: BoardPreference[];
}) {
  const refresh = useServerRefresh();
  const [historyId, setHistoryId] = useState(historyOptions[0]?.id ?? "");
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amending, setAmending] = useState<string | null>(null);
  const [amendedStatement, setAmendedStatement] = useState("");

  const hasHistories = historyOptions.length > 0;

  async function run(key: string, action: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  function addPreference() {
    if (!historyId) return;
    return run("add", async () => {
      await apiRequest(`/api/collaboration/history/${historyId}/preferences`, {
        method: "POST",
        body: JSON.stringify({ statement: statement.trim() }),
      });
      setStatement("");
      return `Submitted for ${counterpartName} to acknowledge.`;
    });
  }

  function acknowledge(preference: BoardPreference) {
    return run(`ack-${preference.id}`, async () => {
      await apiRequest(
        `/api/collaboration/history/${preference.historyId}/preferences/${preference.id}/acknowledge`,
        { method: "POST" },
      );
      return "Acknowledged. The statement is now a confirmed working preference.";
    });
  }

  function amend(preference: BoardPreference) {
    return run(`amend-${preference.id}`, async () => {
      await apiRequest(`/api/collaboration/history/${preference.historyId}/preferences/${preference.id}`, {
        method: "POST",
        body: JSON.stringify({ statement: amendedStatement.trim() }),
      });
      setAmending(null);
      setAmendedStatement("");
      return "Amendment submitted. Both parties must acknowledge the new statement.";
    });
  }

  function authorLabel(preference: BoardPreference) {
    return preference.authorId === viewerId ? "You" : counterpartName;
  }

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Confirmed preferences</h3>
        {confirmed.length === 0 ? (
          <p className="text-sm text-muted">
            No confirmed preferences yet. Anything you propose stays pending until {counterpartName} acknowledges it.
          </p>
        ) : (
          <ul className="divide-y divide-border-base">
            {confirmed.map((preference) => (
              <li key={preference.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <p className="text-sm leading-relaxed text-foreground">{preference.statement}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="success">Confirmed</Badge>
                  <span>Proposed by {authorLabel(preference)}</span>
                  {preference.acknowledgedAt ? (
                    <span>· acknowledged {formatDateTime(preference.acknowledgedAt)}</span>
                  ) : null}
                  {preference.authorId === viewerId ? (
                    <button
                      type="button"
                      className={buttonClass("link", "sm")}
                      onClick={() => {
                        setAmending(amending === preference.id ? null : preference.id);
                        setAmendedStatement(preference.statement);
                      }}
                    >
                      {amending === preference.id ? "Cancel" : "Amend"}
                    </button>
                  ) : null}
                </div>

                {amending === preference.id ? (
                  <div className="space-y-2 rounded-lg border border-border-base bg-surface-muted px-3 py-3">
                    <label htmlFor={`amend-${preference.id}`} className="text-xs font-semibold text-foreground">
                      Revised statement
                    </label>
                    <textarea
                      id={`amend-${preference.id}`}
                      className={textareaClass}
                      value={amendedStatement}
                      onChange={(event) => setAmendedStatement(event.target.value)}
                      maxLength={500}
                    />
                    <p className="text-xs text-muted">
                      A confirmed statement is never edited in place. Submitting a revision reverts it to
                      pending so both parties acknowledge the new wording.
                    </p>
                    <button
                      type="button"
                      className={buttonClass("secondary", "sm")}
                      onClick={() => void amend(preference)}
                      disabled={busy === `amend-${preference.id}` || amendedStatement.trim().length < 5}
                    >
                      {busy === `amend-${preference.id}` ? "Submitting…" : "Submit revision"}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Awaiting acknowledgement</h3>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Nothing is waiting for either party.</p>
        ) : (
          <ul className="divide-y divide-border-base">
            {pending.map((preference) => {
              const mine = preference.authorId === viewerId;
              return (
                <li
                  key={preference.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm leading-relaxed text-foreground">{preference.statement}</p>
                    <p className="mt-1 text-xs text-muted">
                      Proposed by {authorLabel(preference)}
                      {preference.createdAt ? ` · ${formatDateTime(preference.createdAt)}` : ""}
                    </p>
                  </div>
                  {mine ? (
                    <Badge tone="warning">Waiting on {counterpartName}</Badge>
                  ) : (
                    <button
                      type="button"
                      className={buttonClass("primary", "sm")}
                      onClick={() => void acknowledge(preference)}
                      disabled={busy === `ack-${preference.id}`}
                    >
                      {busy === `ack-${preference.id}` ? "Acknowledging…" : "Acknowledge"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border-base bg-surface-muted px-4 py-4">
        <h3 className="text-sm font-semibold text-foreground">Propose a working preference</h3>
        <p className="text-xs leading-relaxed text-muted">
          Write it as a working agreement in the second person, for example &quot;Shares annotated drafts
          before each review call&quot;. {counterpartName} must acknowledge it before it counts.
        </p>
        {hasHistories ? (
          <div className="space-y-3">
            {historyOptions.length > 1 ? (
              <Field label="Completed project" htmlFor="preference-history">
                <select
                  id="preference-history"
                  className={selectClass}
                  value={historyId}
                  onChange={(event) => setHistoryId(event.target.value)}
                >
                  {historyOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field
              label="Statement"
              htmlFor="preference-statement"
              hint={`${statement.trim().length}/500 characters · minimum 5`}
            >
              <textarea
                id="preference-statement"
                className={textareaClass}
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                maxLength={500}
                placeholder="Communicates blockers the same day they appear"
              />
            </Field>
            <button
              type="button"
              className={buttonClass("primary", "md")}
              onClick={() => void addPreference()}
              disabled={busy === "add" || statement.trim().length < 5}
            >
              {busy === "add" ? "Submitting…" : "Submit for acknowledgement"}
            </button>
          </div>
        ) : (
          <EmptyState
            title="No completed project to attach a preference to"
            description="Working preferences belong to a completed project, so this becomes available once a collaboration is closed."
          />
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted">
        Preferences stay inside this pair. Nobody outside the two of you can read them.
      </p>
    </div>
  );
}
