"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, Skeleton, StatusBadge, textareaClass } from "@/components/ui";
import type { ComparisonGridRow } from "@/components/comparison-grid";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { navigateAfterMutation } from "@/lib/use-server-refresh";

/**
 * AG Grid manipulates the DOM the moment it mounts, so the grid is loaded in the
 * browser only. The skeleton keeps the card from collapsing while it arrives.
 */
const ComparisonGrid = dynamic(() => import("@/components/comparison-grid").then((module) => module.ComparisonGrid), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

/**
 * Requirement 8 — the Comparison Workspace.
 *
 * Quotations are rendered as columns and their line items are aligned by
 * description, so a price difference sits on one row instead of in two
 * unrelated tables. Annotations are private to the Client; the API never
 * returns them to a Freelancer (Requirement 8.7).
 */

export interface WorkspaceColumn {
  quotationId: string;
  freelancerId: string;
  freelancerName: string;
  status: string;
  total: number;
  timelineDays: number;
  submittedAt: string | null;
  notes: string;
  lineItems: Array<{ description: string; price: number; pricingConfidence?: string }>;
}

export interface WorkspaceState {
  workspaceId: string | null;
  briefId: string;
  briefTitle: string;
  available: boolean;
  multiColumn: boolean;
  selections: string[];
  columns: WorkspaceColumn[];
  addable: Array<{ quotationId: string; freelancerName: string; total: number }>;
  annotations: Array<{ quotationId: string; attribute: string; noteText: string; updatedAt: string }>;
  aiSummary: {
    summary: string;
    keyDifferences: Array<{ attribute: string; comparison: string }>;
    groundedQuotationIds: string[];
  } | null;
  aiSummaryGeneratedAt: string | null;
  aiSummaryNotice: string | null;
  exportedAt: string | null;
}

const NOTE_ATTRIBUTE = "note";

export function ComparisonWorkspace({ briefId, initial }: { briefId: string; initial: WorkspaceState }) {
  const [state, setState] = useState<WorkspaceState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const descriptions: string[] = [];
    for (const column of state.columns) {
      for (const item of column.lineItems) {
        if (item.description && !descriptions.includes(item.description)) descriptions.push(item.description);
      }
    }
    return descriptions;
  }, [state.columns]);

  function annotationFor(quotationId: string, attribute: string): string {
    return state.annotations.find((a) => a.quotationId === quotationId && a.attribute === attribute)?.noteText ?? "";
  }

  async function mutate(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    try {
      const data = await apiRequest<{ workspace: WorkspaceState }>(`/api/briefs/${briefId}/comparison`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setState(data.workspace);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function runAction(label: string, path: string, body?: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    try {
      const data = await apiRequest<{ workspace?: WorkspaceState; notice?: string | null }>(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (data.workspace) setState(data.workspace);
      else if (typeof data.notice === "string") setState((current) => ({ ...current, aiSummaryNotice: data.notice ?? null }));
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function accept(quotationId: string) {
    setBusy("accept");
    setError(null);
    try {
      const data = await apiRequest<{ agreementId: string }>(`/api/briefs/${briefId}/comparison/accept`, {
        method: "POST",
        body: JSON.stringify({ quotationId }),
      });
      navigateAfterMutation(`/agreements/${data.agreementId}`);
    } catch (thrown) {
      setError(errorMessage(thrown));
      setBusy(null);
    }
  }

  if (!state.available) {
    return (
      <EmptyState
        title="Comparison needs two quotations"
        description="At least two submitted quotations are required before bids can be aligned side by side."
      />
    );
  }

  /** Reads one value per aligned quotation, keyed by quotation id. */
  function cellsFor(read: (column: WorkspaceColumn) => string): Record<string, string> {
    return Object.fromEntries(state.columns.map((column) => [column.quotationId, read(column)]));
  }

  // The grid pivots the quotations into columns: one row per attribute, so a
  // price difference sits on a single row instead of in two unrelated tables.
  const gridRows: ComparisonGridRow[] = [
    {
      rowKey: "total",
      attribute: "Total",
      emphasis: true,
      cells: cellsFor((column) => formatMoney(column.total)),
    },
    {
      rowKey: "timeline",
      attribute: "Timeline",
      cells: cellsFor((column) => `${column.timelineDays} days`),
    },
    {
      rowKey: "submitted",
      attribute: "Submitted",
      cells: cellsFor((column) => (column.submittedAt ? formatDateTime(column.submittedAt) : "—")),
    },
    ...rows.map((description) => ({
      rowKey: `item:${description}`,
      attribute: description,
      cells: cellsFor((column) => {
        const item = column.lineItems.find((lineItem) => lineItem.description === description);
        return item ? formatMoney(item.price) : "—";
      }),
    })),
  ];

  return (
    <div className="space-y-5">
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {state.addable.length > 0 ? (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Add to comparison</span>
            {state.addable.map((candidate) => (
              <button
                key={candidate.quotationId}
                type="button"
                className={buttonClass("secondary", "sm")}
                onClick={() => void mutate("add", { add: [candidate.quotationId] })}
                disabled={busy !== null}
              >
                + {candidate.freelancerName} · {formatMoney(candidate.total)}
              </button>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Aligned bids"
          description="One attribute per row, one quotation per column. Resize a column, filter the attributes, or export exactly what you see."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Aligned</span>
            {state.columns.map((column) => (
              <div key={column.quotationId} className="flex items-center gap-2">
                <StatusBadge status={column.status} />
                <button
                  type="button"
                  className="text-xs text-muted underline-offset-2 hover:text-danger hover:underline"
                  onClick={() => void mutate("remove", { remove: [column.quotationId] })}
                  disabled={busy !== null}
                >
                  Remove {column.freelancerName}
                </button>
              </div>
            ))}
          </div>

          <ComparisonGrid rows={gridRows} columns={state.columns} briefTitle={state.briefTitle} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Private notes"
          description="Only you can read these — the API never returns an annotation to a Freelancer."
        />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            {state.columns.map((column) => (
              <div key={column.quotationId} className="space-y-1.5">
                <label
                  className="block text-xs font-semibold uppercase tracking-wide text-muted"
                  htmlFor={`note-${column.quotationId}`}
                >
                  Private note · {column.freelancerName}
                </label>
                <textarea
                  id={`note-${column.quotationId}`}
                  className={cn(textareaClass, "min-h-16 text-xs")}
                  defaultValue={annotationFor(column.quotationId, NOTE_ATTRIBUTE)}
                  maxLength={500}
                  placeholder="Why this bid stands out…"
                  onBlur={(event) => {
                    const noteText = event.target.value.trim();
                    if (noteText === annotationFor(column.quotationId, NOTE_ATTRIBUTE)) return;
                    void mutate(
                      "annotate",
                      noteText
                        ? { annotation: { quotationId: column.quotationId, attribute: NOTE_ATTRIBUTE, noteText } }
                        : { removeAnnotation: { quotationId: column.quotationId, attribute: NOTE_ATTRIBUTE } },
                    );
                  }}
                />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="AI summary"
          description="Grounded in the selected quotations only — it never invents a number that is not in the bids."
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                className={buttonClass("secondary", "sm")}
                onClick={() => void runAction("summary", `/api/briefs/${briefId}/comparison/ai-summary`)}
                disabled={busy !== null || state.columns.length < 2}
              >
                {busy === "summary" ? "Analysing…" : state.aiSummary ? "Regenerate" : "Generate summary"}
              </button>
              <a
                href={`/api/briefs/${briefId}/comparison/export`}
                className={buttonClass("ghost", "sm")}
                aria-disabled={busy !== null}
              >
                Export PDF
              </a>
            </div>
          }
        />
        <CardBody className="space-y-3">
          {state.aiSummaryNotice ? <Alert tone="warning">{state.aiSummaryNotice}</Alert> : null}
          {busy === "summary" ? (
            <div className="space-y-3" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Aligning the bids and writing a neutral summary…
              </p>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <div className="space-y-2 pt-1">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ) : state.aiSummary ? (
            <>
              <p className="text-sm leading-relaxed">{state.aiSummary.summary}</p>
              <ul className="space-y-2">
                {state.aiSummary.keyDifferences.map((difference) => (
                  <li key={difference.attribute} className="rounded-lg bg-surface-muted px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{difference.attribute}</p>
                    <p className="mt-0.5 text-sm leading-relaxed">{difference.comparison}</p>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                {state.aiSummaryGeneratedAt ? `Generated ${formatDateTime(state.aiSummaryGeneratedAt)} · ` : ""}
                Grounded in {state.aiSummary.groundedQuotationIds.length} quotations.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">
              No summary yet. Generate one to get a neutral description of where the bids actually differ.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Accept a quotation" description="Acceptance creates the agreement. Nothing is signed yet." />
        <CardBody className="flex flex-wrap gap-2">
          {state.columns.map((column) => (
            <button
              key={column.quotationId}
              type="button"
              className={buttonClass("primary", "sm")}
              onClick={() => void accept(column.quotationId)}
              disabled={busy !== null}
            >
              Accept {column.freelancerName} · {formatMoney(column.total)}
            </button>
          ))}
        </CardBody>
      </Card>

      {state.exportedAt ? (
        <p className="text-xs text-muted">
          <Badge tone="success">Exported</Badge> Last PDF export {formatDateTime(state.exportedAt)}
        </p>
      ) : null}
    </div>
  );
}
