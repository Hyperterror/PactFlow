import type { NextRequest } from "next/server";
import { handler } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getDeliverableForViewer } from "@/lib/deliverables";
import { readVerifiedPreview } from "@/lib/storage/signed-url";

type Params = { params: Promise<{ deliverableId: string }> };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Requirement 14.5 — the watermarked preview is hash-verified before it is
 * served. Only the two project participants can request it.
 */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  const { deliverable } = await getDeliverableForViewer(deliverableId, user.id);
  const buffer = await readVerifiedPreview(deliverableId);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${encodeURIComponent(deliverable.fileName)}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
