import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { listMessages, postMessage, PostMessageSchema } from "@/lib/change-requests/discussion";
import { parseJson } from "@/lib/http";

type Params = { params: Promise<{ agreementId: string }> };

/** Requirement 10.5 — chronological thread with the View Proposal badge. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const { messages, viewerRole } = await listMessages(agreementId, user.id);
  return json({ messages, viewerRole });
});

/**
 * Requirement 10.3 — tagging a message as a scope-change proposal only works at
 * creation time; the badge is accepted here and creating a change request
 * separately is rejected with SCOPE_PROPOSAL_REQUIRES_CHANGE_REQUEST.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const input = await parseJson(req, PostMessageSchema);
  const message = await postMessage(agreementId, user.id, input);
  return json({ message }, 201);
});
