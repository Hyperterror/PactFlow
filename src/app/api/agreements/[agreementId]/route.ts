import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getAgreementDetail } from "@/lib/agreements";
import { toAgreementDto, toMilestoneDto } from "@/lib/serializers";

type Params = { params: Promise<{ agreementId: string }> };

/** Requirement 23.2 — only project participants may read the Agreement. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const detail = await getAgreementDetail(agreementId, user.id);
  return json({
    agreement: toAgreementDto(detail.agreement, {
      approvals: detail.approvals,
      versions: detail.versions,
      currentVersion: detail.currentVersion,
    }),
    role: detail.role,
    milestones: detail.milestones.map(toMilestoneDto),
    approvalState: detail.approvalState,
  });
});
