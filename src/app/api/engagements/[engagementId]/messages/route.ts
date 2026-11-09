import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { MessageSchema, postMessage } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Discovery discussion — no Agreement required. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const { content } = await parseJson(req, MessageSchema);
  const message = await postMessage(engagementId, user.id, content);
  return json({ message }, 201);
});
