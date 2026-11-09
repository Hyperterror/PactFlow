import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { CancelSchema, cancelEngagement, toEngagementDto } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Closes the engagement; the proposal, messages and versions are kept. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const { reason } = await parseJson(req, CancelSchema);
  const engagement = await cancelEngagement(engagementId, user.id, reason);
  return json({ engagement: toEngagementDto(engagement) });
});
