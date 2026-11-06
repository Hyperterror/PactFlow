import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getChangeRequestDetail } from "@/lib/change-requests";

type Params = { params: Promise<{ agreementId: string; changeRequestId: string }> };

/** Requirement 11.3 — detail with the Scope_Label, votes and disputes. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { changeRequestId } = await params;
  const detail = await getChangeRequestDetail(changeRequestId, user.id);

  return json({
    changeRequest: {
      ...detail,
      scopeClassifiedAt: detail.scopeClassifiedAt?.toISOString() ?? null,
      responseDeadline: detail.responseDeadline.toISOString(),
      reminderSentAt: detail.reminderSentAt?.toISOString() ?? null,
      votes: detail.votes.map((vote) => ({
        ...vote,
        createdAt: vote.createdAt.toISOString(),
        retractedAt: vote.retractedAt?.toISOString() ?? null,
      })),
      disputes: detail.disputes.map((dispute) => ({
        ...dispute,
        createdAt: dispute.createdAt.toISOString(),
      })),
    },
  });
});
