import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { deleteMessage, tagAsScopeProposal } from "@/lib/change-requests/discussion";

type Params = { params: Promise<{ agreementId: string; messageId: string }> };

/**
 * Requirement 10.3 — tagging an existing message as a scope-change proposal is
 * rejected; proposals are created only through the change-request endpoint.
 */
export const PATCH = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { messageId } = await params;
  await tagAsScopeProposal(messageId, user.id);
  return json({ tagged: true });
});

/** Requirement 10.6 — a message linked to a scope-change record cannot be deleted. */
export const DELETE = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { messageId } = await params;
  await deleteMessage(messageId, user.id);
  return json({ deleted: true });
});
