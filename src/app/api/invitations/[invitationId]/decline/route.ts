import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { declineInvitation } from "@/lib/invitations";
import { toInvitationDto } from "@/lib/serializers";

type Params = { params: Promise<{ invitationId: string }> };

/**
 * Requirement 3.5 — declining revokes Brief read access and invalidates any
 * outstanding signed URLs for the pair.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { invitationId } = await params;
  const invitation = await declineInvitation(invitationId, user.id);
  return json({ invitation: toInvitationDto(invitation) });
});
