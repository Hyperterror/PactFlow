import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { assertBriefOwner } from "@/lib/access";
import {
  SendInvitationSchema,
  listInvitationsForBrief,
  listInvitationsForFreelancer,
  sendInvitation,
} from "@/lib/invitations";
import { toInvitationDto } from "@/lib/serializers";

const QuerySchema = z.object({ briefId: z.string().min(1).optional() });

/**
 * Requirement 3.1 — `?briefId=` lists the Client's outgoing invitations for a
 * Brief (owner only); without it the Freelancer's inbox is returned.
 */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { briefId } = parseQuery(req, QuerySchema);

  if (briefId) {
    await assertBriefOwner(briefId, user.id);
    const invitations = await listInvitationsForBrief(briefId);
    return json({ invitations: invitations.map(toInvitationDto) });
  }

  const invitations = await listInvitationsForFreelancer(user.id);
  return json({ invitations: invitations.map(toInvitationDto) });
});

/** Requirements 3.1–3.3 — send an invitation to a registered Freelancer. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const input = await parseJson(req, SendInvitationSchema);
  const invitation = await sendInvitation(user.id, input);
  return json({ invitation: toInvitationDto(invitation) }, 201);
});
