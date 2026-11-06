import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { approveDeliverable } from "@/lib/deliverables/review";
import { toDeliverableDto } from "@/lib/serializers";

type Params = { params: Promise<{ deliverableId: string }> };

/**
 * Requirements 15.2 / 15.6 — Client approval enables the payment flow; the
 * Original_File stays locked until the payment is captured.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  const deliverable = await approveDeliverable(deliverableId, user.id);
  return json({ deliverable: toDeliverableDto(deliverable) });
});
