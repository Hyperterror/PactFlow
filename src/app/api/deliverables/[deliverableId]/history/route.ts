import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getDeliverableForViewer } from "@/lib/deliverables";
import { listDeliveryHistory } from "@/lib/storage/signed-url";

type Params = { params: Promise<{ deliverableId: string }> };

/** Requirement 19.7 — payment and delivery history for the Client. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  // Enforces participant access before any history is disclosed.
  await getDeliverableForViewer(deliverableId, user.id);
  const history = await listDeliveryHistory(user.id, deliverableId);
  return json({ history });
});
