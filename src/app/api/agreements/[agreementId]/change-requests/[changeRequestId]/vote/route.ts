import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { VoteSchema, castVote } from "@/lib/change-requests";

type Params = { params: Promise<{ agreementId: string; changeRequestId: string }> };

/**
 * Requirements 12.2/12.3/12.6 — one vote per party. A single APPROVE never
 * changes the status; the second APPROVE creates the new version atomically.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { changeRequestId } = await params;
  const input = await parseJson(req, VoteSchema);
  const result = await castVote(changeRequestId, user.id, input);

  return json({
    changeRequest: {
      id: result.changeRequest.id,
      status: result.changeRequest.status,
      scopeLabel: result.changeRequest.scopeLabel,
      responseDeadline: result.changeRequest.responseDeadline.toISOString(),
    },
    newVersionNumber: result.newVersionNumber,
  });
});
