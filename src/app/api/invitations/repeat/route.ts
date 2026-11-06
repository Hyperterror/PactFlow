import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { sendRepeatInvitation } from "@/lib/collaboration";
import { toInvitationDto } from "@/lib/serializers";

/**
 * A repeat invitation is always addressed to the Freelancer from the prior
 * engagement, so the identifier is required here even though the standard
 * invitation accepts an email lookup instead.
 */
const BodySchema = z.object({
  briefId: z.string().min(1, "briefId is required."),
  freelancerId: z.string().min(1, "A repeat invitation needs the prior collaborator."),
});

/**
 * Requirement 22.4 — a repeat invitation reuses the standard invitation flow but
 * additionally carries the pair's most recent Collaboration_Summary (or the
 * history entry when no summary has ever been generated).
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const input = await parseJson(req, BodySchema);
  const invitation = await sendRepeatInvitation(input.briefId, user.id, input.freelancerId);

  return json(
    {
      invitation: toInvitationDto(invitation),
      repeat: true,
      attachedSummaryId: invitation.attachmentSummaryId,
      attachedHistoryId: invitation.attachmentHistoryId,
    },
    201,
  );
});
