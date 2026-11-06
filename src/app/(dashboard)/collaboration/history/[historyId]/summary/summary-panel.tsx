"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, Skeleton, textareaClass } from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useServerRefresh } from "@/lib/use-server-refresh";

export type SummarySourceType = "AGREEMENT" | "DELIVERABLE" | "WORKING_PREFERENCE";

export interface SummaryStatementView {
  text: string;
  sourceType: SummarySourceType;
  sourceId: string;
}

export interface SummaryContentView {
  summary: string;
  statements: SummaryStatementView[];
}

export interface SummaryFlagView {
  statementIndex: number;
  flaggedByUserId: string;
  flaggedAt: string;
  reason?: string;
}

export interface StoredSummaryView {
  id: string;
  generatedAt: string;
  content: SummaryContentView | null;
  flaggedStatements: SummaryFlagView[];
}

const SOURCE_LABELS: Record<SummarySourceType, string> = {
  AGREEMENT: "Agreement",
  DELIVERABLE: "Deliverable",
  WORKING_PREFERENCE: "Working preference",
};

/**
 * Requirements 21.1-21.6 — the summary is served from a 24-hour cache and only
 * bypassed with an explicit regenerate. Every statement carries the record it came
 * from, and flagging records who flagged what without altering the history.
 */
export function SummaryPanel({
  historyId,
  agreementId,
  viewerId,
  cacheWindowHours,
  initial,
}: {
  historyId: string;
  agreementId: string;
  viewerId: string;
  cacheWindowHours: number;
  initial: StoredSummaryView | null;
}) {
  const refresh = useServerRefresh();
  const [content, setContent] = useState<SummaryContentView | null>(initial?.content ?? null);
  const [flagged, setFlagged] = useState<SummaryFlagView[]>(initial?.flaggedStatements ?? []);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initial?.generatedAt ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "regenerate" | string | null>(null);
  const [flagTarget, setFlagTarget] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  async function requestSummary(forceRegenerate: boolean) {
    setBusy(forceRegenerate ? "regenerate" : "generate");
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<{
        content: SummaryContentView | null;
        notice: string | null;
        generatedAt: string | null;
        flaggedStatements: SummaryFlagView[];
      }>(`/api/collaboration/history/${historyId}/summary`, {
        method: "POST",
        body: JSON.stringify({ forceRegenerate }),
      });

      if (data.content) {
        setContent(data.content);
        setFlagged(data.flaggedStatements ?? []);
        setGeneratedAt(data.generatedAt);
      } else {
        setContent(null);
        setNotice(data.notice ?? "No summary could be grounded in this history yet.");
      }
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function flagStatement(statementIndex: number) {
    setBusy(`flag-${statementIndex}`);
    setError(null);
    setNotice(null);
    try {
      const data = await apiRequest<{ flaggedStatements: SummaryFlagView[]; historyModified: boolean }>(
        `/api/collaboration/history/${historyId}/summary/flag`,
        {
          method: "POST",
          body: JSON.stringify({
            statementIndex,
            reason: reason.trim() ? reason.trim() : undefined,
          }),
        },
      );
      setFlagged(data.flaggedStatements ?? []);
      setFlagTarget(null);
      setReason("");
      setNotice("Flag recorded. The underlying collaboration history is unchanged.");
      refresh();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  function flagsFor(index: number) {
    return flagged.filter((flag) => flag.statementIndex === index);
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <Card>
        <CardHeader
          title="AI collaboration summary"
          description={
            generatedAt
              ? `Generated ${formatDateTime(generatedAt)} · cached for ${cacheWindowHours} hours`
              : `Served from a ${cacheWindowHours}-hour cache once generated`
          }
          actions={
            content ? (
              <button
                type="button"
                className={buttonClass("secondary", "sm")}
                onClick={() => void requestSummary(true)}
                disabled={busy !== null}
              >
                {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
              </button>
            ) : null
          }
        />
        <CardBody>
          {busy === "generate" || busy === "regenerate" ? (
            <div className="space-y-3" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Reading the agreement, its deliverables and your confirmed preferences…
              </p>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <div className="space-y-2 pt-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            </div>
          ) : content ? (
            <div className="space-y-5">
              <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{content.summary}</p>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Key statements and their sources
                </h3>
                <ol className="space-y-3">
                  {content.statements.map((statement, index) => {
                    const statementFlags = flagsFor(index);
                    const mine = statementFlags.some((flag) => flag.flaggedByUserId === viewerId);
                    return (
                      <li
                        key={`${statement.sourceType}-${statement.sourceId}-${index}`}
                        className="rounded-lg border border-border-base bg-surface-muted px-3 py-3"
                      >
                        <div className="flex items-start gap-3">
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1 space-y-2">
                            <p className="text-sm leading-relaxed text-foreground">{statement.text}</p>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <Badge tone="info">{SOURCE_LABELS[statement.sourceType]}</Badge>
                              {statement.sourceType === "AGREEMENT" ? (
                                <Link
                                  href={`/agreements/${statement.sourceId}`}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  View agreement
                                </Link>
                              ) : statement.sourceType === "DELIVERABLE" ? (
                                <Link
                                  href={`/agreements/${agreementId}`}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  View on agreement
                                </Link>
                              ) : (
                                <span className="text-muted">Confirmed by both parties</span>
                              )}
                              {statementFlags.length > 0 ? (
                                <Badge tone="danger">
                                  Flagged{statementFlags.length > 1 ? ` ×${statementFlags.length}` : ""}
                                </Badge>
                              ) : null}
                            </div>

                            {statementFlags.length > 0 ? (
                              <ul className="space-y-1 text-xs text-muted">
                                {statementFlags.map((flag) => (
                                  <li key={`${flag.flaggedByUserId}-${flag.flaggedAt}`}>
                                    {flag.flaggedByUserId === viewerId ? "You" : "The other party"} flagged this{" "}
                                    {formatDateTime(flag.flaggedAt)}
                                    {flag.reason ? ` — “${flag.reason}”` : ""}
                                  </li>
                                ))}
                              </ul>
                            ) : null}

                            {flagTarget === index ? (
                              <div className="space-y-2 border-t border-border-base pt-2">
                                <label
                                  htmlFor={`flag-reason-${index}`}
                                  className="text-xs font-semibold text-foreground"
                                >
                                  Why is this inaccurate? (optional)
                                </label>
                                <textarea
                                  id={`flag-reason-${index}`}
                                  className={textareaClass}
                                  value={reason}
                                  maxLength={500}
                                  onChange={(event) => setReason(event.target.value)}
                                  placeholder="The milestone count was two, not three."
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    className={buttonClass("danger", "sm")}
                                    onClick={() => void flagStatement(index)}
                                    disabled={busy === `flag-${index}`}
                                  >
                                    {busy === `flag-${index}` ? "Flagging…" : "Confirm flag"}
                                  </button>
                                  <button
                                    type="button"
                                    className={buttonClass("ghost", "sm")}
                                    onClick={() => {
                                      setFlagTarget(null);
                                      setReason("");
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={buttonClass("link", "sm")}
                                onClick={() => {
                                  setFlagTarget(index);
                                  setReason("");
                                }}
                                disabled={mine}
                              >
                                {mine ? "Already flagged by you" : "Flag as inaccurate"}
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-muted">
                No summary has been generated for this project yet. Generating one grounds every statement in
                this collaboration history — the agreement, its approved deliverables and the preferences you
                both confirmed. Nothing outside those records is used.
              </p>
              <button
                type="button"
                className={buttonClass("primary", "md")}
                onClick={() => void requestSummary(false)}
                disabled={busy !== null}
              >
                {busy === "generate" ? "Generating…" : "Generate summary"}
              </button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
