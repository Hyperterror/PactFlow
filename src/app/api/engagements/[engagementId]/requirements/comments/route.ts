import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { CommentSchema, addRequirementsComment } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** A review comment on a version, optionally anchored to one requirement ID. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const input = await parseJson(req, CommentSchema);
  const comment = await addRequirementsComment(engagementId, user.id, input);
  return json({ comment }, 201);
});
