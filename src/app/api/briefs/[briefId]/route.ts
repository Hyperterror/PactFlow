import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { updateBrief } from "@/lib/briefs";
import { UpdateBriefSchema } from "@/lib/briefs";
import { assertBriefAccess } from "@/lib/access";
import { toBriefDto } from "@/lib/serializers";

type Params = { params: Promise<{ briefId: string }> };

/** Requirement 23.2 — only project participants may read a Brief. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const { brief, role } = await assertBriefAccess(briefId, user.id);
  return json({ brief: toBriefDto(brief), role });
});

/** Requirement 2.4/2.6 — edits are limited to DRAFT Briefs. */
export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { briefId } = await params;
  const input = await parseJson(req, UpdateBriefSchema);
  const brief = await updateBrief(briefId, user.id, input);
  return json({ brief: toBriefDto(brief) });
});
