import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getMilestoneWithDeliverables } from "@/lib/milestones";
import { toDeliverableDto, toMilestoneDto, toPaymentDto } from "@/lib/serializers";

type Params = { params: Promise<{ milestoneId: string }> };

/** Requirement 13.2 — milestone detail with its deliverables and payment. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { milestoneId } = await params;
  const { milestone, deliverables, payment, role } = await getMilestoneWithDeliverables(
    milestoneId,
    user.id,
  );
  return json({
    milestone: toMilestoneDto(milestone),
    deliverables: deliverables.map(toDeliverableDto),
    payment: payment ? toPaymentDto(payment) : null,
    role,
  });
});
