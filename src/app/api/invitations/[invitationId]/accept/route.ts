import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { acceptInvitation } from "@/lib/invitations";
import { toInvitationDto } from "@/lib/serializers";

type Params = { params: Promise<{ invitationId: string }> };

/** Requirement 3.4 — only the invited Freelancer can accept. */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { invitationId } = await params;
  const invitation = await acceptInvitation(invitationId, user.id);
  return json({ invitation: toInvitationDto(invitation) });
});
