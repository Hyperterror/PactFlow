import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { openWorkspace } from "@/lib/quotations/comparison";
import { ComparisonWorkspace, type WorkspaceState } from "./comparison-workspace";
import { Alert, buttonClass, PageHeader } from "@/components/ui";

type Params = { params: Promise<{ briefId: string }> };

export const metadata: Metadata = { title: "Comparison" };

/** Requirements 8.1–8.11 — server-rendered read model for the workspace. */
export default async function ComparePage({ params }: Params) {
  const user = await requirePageSession();
  const { briefId } = await params;

  let state;
  try {
    state = await openWorkspace(briefId, user.id);
  } catch {
    // Only the owning Client may open the workspace; anyone else gets a 404 so
    // the brief's existence is not disclosed.
    notFound();
  }

  const initial: WorkspaceState = {
    ...state,
    columns: state.columns.map((column) => ({
      ...column,
      submittedAt: column.submittedAt?.toISOString() ?? null,
    })),
    annotations: state.annotations.map((annotation) => ({
      ...annotation,
      updatedAt: annotation.updatedAt.toISOString(),
    })),
    exportedAt: state.exportedAt?.toISOString() ?? null,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Step 4 of 4 · comparison workspace"
        title={state.briefTitle}
        description="Prices are aligned by line item so the gap between two bids is a row, not a guess. Annotations stay private to you."
        actions={
          <Link href={`/briefs/${briefId}`} className={buttonClass("secondary", "md")}>
            Back to brief
          </Link>
        }
      />

      {state.selections.length < 2 ? (
        <Alert tone="info" className="mb-4">
          Select at least two quotations to align them. Every submitted quotation for this brief is available below.
        </Alert>
      ) : null}

      <ComparisonWorkspace briefId={briefId} initial={initial} />
    </div>
  );
}
