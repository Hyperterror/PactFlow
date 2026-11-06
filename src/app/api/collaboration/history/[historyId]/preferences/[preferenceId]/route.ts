import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { amendConfirmedPreference, updateConfirmedPreference } from "@/lib/collaboration";

type Params = { params: Promise<{ historyId: string; preferenceId: string }> };

const AmendSchema = z.object({
  statement: z.string().trim().min(5).max(500),
});

/**
 * Requirement 20.7 — a CONFIRMED preference can never be edited in place.
 *
 * `PUT` is the in-place modification attempt and always answers 403. The
 * supported path is `/amend`, which creates a new statement and resets both
 * parties to PENDING_ACKNOWLEDGEMENT.
 */
export const PUT = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId, preferenceId } = await params;
  await updateConfirmedPreference(historyId, preferenceId, user.id);
  return json({ updated: false });
});

export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId, preferenceId } = await params;
  const input = await parseJson(req, AmendSchema);
  const preference = await amendConfirmedPreference(historyId, preferenceId, user.id, input);

  return json(
    {
      preference: {
        id: preference.id,
        statement: preference.statement,
        status: preference.status,
        acknowledgedAt: preference.acknowledgedAt?.toISOString() ?? null,
      },
      note: "The amended statement requires fresh acknowledgement from both parties.",
    },
    201,
  );
});
