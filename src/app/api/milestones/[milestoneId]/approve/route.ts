import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { approveDelivery } from "@/lib/milestones";
import { toMilestoneDto } from "@/lib/serializers";

type Params = { params: Promise<{ milestoneId: string }> };

/**
 * Requirement 13.5 — Client approval of the delivery unlocks the payment flow
 * for that milestone.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { milestoneId } = await params;
  const milestone = await approveDelivery(milestoneId, user.id);
  return json({ milestone: toMilestoneDto(milestone) });
});
