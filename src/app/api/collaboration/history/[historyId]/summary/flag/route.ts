import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { flagSummaryStatement } from "@/lib/collaboration";

type Params = { params: Promise<{ historyId: string }> };

const BodySchema = z.object({
  summaryId: z.string().min(1).optional(),
  statementIndex: z.coerce.number().int().min(0),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Requirement 21.5 — a recipient may flag a single statement as inaccurate.
 * The flag records the user and timestamp and never rewrites the underlying
 * Collaboration_History record.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId } = await params;
  const input = await parseJson(req, BodySchema);

  const summaryId =
    input.summaryId ??
    (
      await prisma.collaborationSummary.findFirst({
        where: { historyId },
        orderBy: { generatedAt: "desc" },
        select: { id: true },
      })
    )?.id;

  if (!summaryId) throw new NotFoundError("CollaborationSummary");

  const summary = await flagSummaryStatement(summaryId, user.id, {
    statementIndex: input.statementIndex,
    reason: input.reason,
  });

  const flagged = Array.isArray(summary.flaggedStatements) ? summary.flaggedStatements : [];

  return json({
    summaryId: summary.id,
    historyId: summary.historyId,
    flaggedStatements: flagged,
    // History stays untouched by design; only the flag list grows.
    historyModified: false,
  });
});
