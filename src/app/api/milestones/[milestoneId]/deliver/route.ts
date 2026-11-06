import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { markDelivered } from "@/lib/milestones";
import { toMilestoneDto } from "@/lib/serializers";

type Params = { params: Promise<{ milestoneId: string }> };

/**
 * Requirement 13.3 — a Deliverable must exist in the Delivery Room before the
 * Freelancer can mark the milestone delivered.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { milestoneId } = await params;
  const milestone = await markDelivered(milestoneId, user.id);
  return json({ milestone: toMilestoneDto(milestone) });
});
