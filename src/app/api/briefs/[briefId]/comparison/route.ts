import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import {
  addToComparison,
  deleteAnnotation,
  openWorkspace,
  removeFromComparison,
  saveAnnotation,
  type ComparisonWorkspaceState,
} from "@/lib/quotations/comparison";

type Params = { params: Promise<{ briefId: string }> };

const PutSchema = z.object({
  selections: z.array(z.string().min(1)).max(50).optional(),
  add: z.array(z.string().min(1)).max(50).optional(),
  remove: z.array(z.string().min(1)).max(50).optional(),
  annotation: z
    .object({
      quotationId: z.string().min(1),
      attribute: z.string().min(1).max(80),
      noteText: z.string().trim().min(1).max(500),
    })
    .optional(),
  removeAnnotation: z
    .object({
      quotationId: z.string().min(1),
      attribute: z.string().min(1).max(80),
    })
    .optional(),
});

/** Dates become ISO strings so the state is directly JSON-serialisable. */
function serialise(state: ComparisonWorkspaceState) {
  return {
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
}

/** Requirements 8.1/8.2/8.9 — the workspace read model (Client only). */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const state = await openWorkspace(briefId, user.id);
  return json({ workspace: serialise(state) });
});

/**
 * Requirement 8.3/8.7 — idempotent selection updates plus private annotations.
 *
 * Every operation is applied through the library so each one is audited and the
 * resulting state is returned in a single response.
 */
export const PUT = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const input = await parseJson(req, PutSchema);

  let state = await openWorkspace(briefId, user.id);

  const desired = input.selections;
  if (desired) {
    const current = new Set(state.selections);
    for (const quotationId of desired) {
      if (!current.has(quotationId)) {
        state = await addToComparison(briefId, user.id, quotationId);
      }
    }
    const wanted = new Set(desired);
    for (const quotationId of state.selections) {
      if (!wanted.has(quotationId)) {
        state = await removeFromComparison(briefId, user.id, quotationId);
      }
    }
  }

  for (const quotationId of input.add ?? []) {
    state = await addToComparison(briefId, user.id, quotationId);
  }
  for (const quotationId of input.remove ?? []) {
    state = await removeFromComparison(briefId, user.id, quotationId);
  }
  if (input.annotation) {
    state = await saveAnnotation(briefId, user.id, input.annotation);
  }
  if (input.removeAnnotation) {
    state = await deleteAnnotation(briefId, user.id, input.removeAnnotation);
  }

  return json({ workspace: serialise(state) });
});
