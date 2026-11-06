import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getDeliverableForViewer, listVersions } from "@/lib/deliverables";
import { listRevisionRequests } from "@/lib/deliverables/review";
import { toDeliverableDto } from "@/lib/serializers";

type Params = { params: Promise<{ deliverableId: string }> };

/**
 * Requirements 14.5 / 23.2 — detail plus preview metadata for the two project
 * participants. Storage keys are never included in the response.
 */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  const { deliverable, role } = await getDeliverableForViewer(deliverableId, user.id);
  const [versions, revisions] = await Promise.all([
    listVersions(deliverable.milestoneId),
    listRevisionRequests(deliverableId),
  ]);
  return json({
    deliverable: toDeliverableDto(deliverable),
    role,
    versions: versions.map(toDeliverableDto),
    revisionRequests: revisions,
  });
});
