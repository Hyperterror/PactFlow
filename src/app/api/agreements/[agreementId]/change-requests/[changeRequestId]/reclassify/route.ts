import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { assertCanReclassify } from "@/lib/change-requests";
import { classifyChangeRequest } from "@/lib/ai/scope-classification";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ agreementId: string; changeRequestId: string }> };

/**
 * Requirement 11.5 — re-runs the classification (for example after a timeout).
 * The label is advisory: it never changes the request status or anyone's rights.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { changeRequestId } = await params;

  await assertCanReclassify(changeRequestId, user.id);
  const result = await classifyChangeRequest(changeRequestId);
  const changeRequest = await prisma.changeRequest.findUniqueOrThrow({
    where: { id: changeRequestId },
  });

  return json({
    scopeLabel: changeRequest.scopeLabel,
    scopeRationale: changeRequest.scopeRationale,
    scopeClassifiedAt: changeRequest.scopeClassifiedAt?.toISOString() ?? null,
    status: changeRequest.status,
    timedOut: result.timedOut,
  });
});
