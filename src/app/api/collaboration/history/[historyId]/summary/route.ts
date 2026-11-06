import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { SUMMARY_CACHE_HOURS, generateCollaborationSummary } from "@/lib/collaboration";

type Params = { params: Promise<{ historyId: string }> };

const BodySchema = z.object({
  forceRegenerate: z.boolean().optional(),
});

/**
 * Requirement 21.1/21.6 — the 24-hour cache is served by default; passing
 * `forceRegenerate: true` is the only way to bypass it.
 *
 * `notice` carries the "Insufficient collaboration history" message when no
 * summary can be grounded in the history record (Requirement 21.2).
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId } = await params;
  // An empty body is the common case: the caller only wants the cached summary.
  const body = BodySchema.parse(await req.json().catch(() => ({})));
  const result = await generateCollaborationSummary(historyId, user.id, {
    forceRegenerate: body.forceRegenerate ?? false,
  });

  const flagged = Array.isArray(result.summary?.flaggedStatements) ? result.summary.flaggedStatements : [];

  return json({
    summaryId: result.summary?.id ?? null,
    historyId,
    content: result.content,
    cached: result.cached,
    notice: result.notice,
    generatedAt: result.generatedAt ? result.generatedAt.toISOString() : null,
    cacheWindowHours: SUMMARY_CACHE_HOURS,
    flaggedStatements: flagged,
  });
});
