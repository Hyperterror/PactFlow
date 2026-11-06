import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { retractVote } from "@/lib/change-requests";

type Params = { params: Promise<{ agreementId: string; changeRequestId: string }> };

/**
 * Requirement 12.4 — a vote can be retracted until the other party votes; the
 * response deadline is never extended by a retraction.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { changeRequestId } = await params;
  const changeRequest = await retractVote(changeRequestId, user.id);

  return json({
    changeRequest: {
      id: changeRequest.id,
      status: changeRequest.status,
      scopeLabel: changeRequest.scopeLabel,
      responseDeadline: changeRequest.responseDeadline.toISOString(),
    },
  });
});
