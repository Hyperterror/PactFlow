import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { publishBrief } from "@/lib/briefs";
import { toBriefDto } from "@/lib/serializers";

type Params = { params: Promise<{ briefId: string }> };

/** Requirement 2.5 — DRAFT → OPEN, publication timestamp recorded, edits locked. */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const brief = await publishBrief(briefId, user.id);
  return json({ brief: toBriefDto(brief) });
});
