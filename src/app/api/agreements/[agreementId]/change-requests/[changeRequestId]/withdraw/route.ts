import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { withdrawChangeRequest } from "@/lib/change-requests";

type Params = { params: Promise<{ agreementId: string; changeRequestId: string }> };

/** Requirement 12.7 — only the submitter may withdraw, and only while SUBMITTED. */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { changeRequestId } = await params;
  const changeRequest = await withdrawChangeRequest(changeRequestId, user.id);

  return json({
    changeRequest: {
      id: changeRequest.id,
      status: changeRequest.status,
      scopeLabel: changeRequest.scopeLabel,
      responseDeadline: changeRequest.responseDeadline.toISOString(),
    },
  });
});
