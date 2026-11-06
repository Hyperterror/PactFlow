import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { CreateBriefSchema, createBrief, listBriefs, listInvitedBriefs } from "@/lib/briefs";
import { toBriefDto } from "@/lib/serializers";

/** Requirement 2.7 — the Client's Briefs, newest first. */
export const GET = handler(async () => {
  const user = await requireSession();
  const [owned, invited] = await Promise.all([listBriefs(user.id), listInvitedBriefs(user.id)]);
  return json({
    briefs: owned.map(toBriefDto),
    invitedBriefs: invited.map(toBriefDto),
  });
});

/** Requirement 2.1/2.2/2.3 — create a DRAFT Brief and return its identifier. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const input = await parseJson(req, CreateBriefSchema);
  const brief = await createBrief(user.id, input);
  return json({ brief: toBriefDto(brief) }, 201);
});
