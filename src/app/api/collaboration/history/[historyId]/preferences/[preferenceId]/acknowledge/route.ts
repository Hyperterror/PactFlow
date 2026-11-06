import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { acknowledgePreference } from "@/lib/collaboration";

type Params = { params: Promise<{ historyId: string; preferenceId: string }> };

/**
 * Requirement 20.6 — only the other party may acknowledge, and the timestamp is
 * what turns the statement into a CONFIRMED working preference.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { historyId, preferenceId } = await params;
  const preference = await acknowledgePreference(historyId, preferenceId, user.id);

  return json({
    preference: {
      id: preference.id,
      statement: preference.statement,
      status: preference.status,
      acknowledgedAt: preference.acknowledgedAt?.toISOString() ?? null,
    },
  });
});
