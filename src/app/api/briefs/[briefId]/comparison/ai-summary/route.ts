import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requestAIComparison, type ComparisonWorkspaceState } from "@/lib/quotations/comparison";

type Params = { params: Promise<{ briefId: string }> };

/**
 * Requirements 8.4–8.6 — AI comparison summary.
 *
 * Every statement is grounded in the quotations in the workspace and carries a
 * citation. When the model times out or fails validation the workspace stays
 * usable with an explicit "unavailable" notice.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const state: ComparisonWorkspaceState = await requestAIComparison(briefId, user.id);

  return json({
    workspace: {
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
    },
  });
});
