import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { RevisionRequestSchema, submitRevisionRequest } from "@/lib/deliverables/review";
import { toDeliverableDto } from "@/lib/serializers";

type Params = { params: Promise<{ deliverableId: string }> };

/**
 * Requirements 15.3–15.5 — feedback must be 10–5000 characters and the
 * Agreement's revision limit is enforced before the request is recorded.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  const { feedbackText } = await parseJson(req, RevisionRequestSchema);
  const deliverable = await submitRevisionRequest(deliverableId, user.id, feedbackText);
  return json({ deliverable: toDeliverableDto(deliverable) });
});
