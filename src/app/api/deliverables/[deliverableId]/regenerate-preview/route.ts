import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requestPreviewRegeneration } from "@/lib/deliverables";
import { toDeliverableDto } from "@/lib/serializers";

type Params = { params: Promise<{ deliverableId: string }> };

/**
 * Requirement 14.10 — regenerates the preview from the stored Original_File so
 * the Freelancer never has to re-upload.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  const deliverable = await requestPreviewRegeneration(deliverableId, user.id);
  return json({ deliverable: toDeliverableDto(deliverable) });
});
