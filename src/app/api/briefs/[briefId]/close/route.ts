import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { closeBrief } from "@/lib/briefs";
import { toBriefDto } from "@/lib/serializers";

type Params = { params: Promise<{ briefId: string }> };

/**
 * Requirement 3.8 — closing a Brief revokes every pending invitation and
 * notifies each affected Freelancer.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const brief = await closeBrief(briefId, user.id);
  return json({ brief: toBriefDto(brief) });
});
