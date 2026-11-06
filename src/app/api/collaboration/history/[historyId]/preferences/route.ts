import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { PreferenceSchema, addWorkingPreference } from "@/lib/collaboration";

type Params = { params: Promise<{ historyId: string }> };

/**
 * Requirement 20.5 — a preference starts as PENDING_ACKNOWLEDGEMENT and only
 * becomes CONFIRMED when the other party explicitly acknowledges it.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId } = await params;
  const input = await parseJson(req, PreferenceSchema);
  const preference = await addWorkingPreference(historyId, user.id, input);

  return json(
    {
      preference: {
        id: preference.id,
        historyId: preference.historyId,
        statement: preference.statement,
        status: preference.status,
        authorId: preference.authorId,
        acknowledgedAt: preference.acknowledgedAt?.toISOString() ?? null,
        createdAt: preference.createdAt.toISOString(),
      },
    },
    201,
  );
});
