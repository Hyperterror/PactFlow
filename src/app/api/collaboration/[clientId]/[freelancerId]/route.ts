import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getCollaborationProfile } from "@/lib/collaboration";
import { listTemplatesForClient } from "@/lib/collaboration";

type Params = { params: Promise<{ clientId: string; freelancerId: string }> };

/**
 * Requirements 20.3/20.6 — the pair's completed projects and CONFIRMED
 * preferences. Anyone outside the pair is rejected and the attempt is logged.
 */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { clientId, freelancerId } = await params;
  const profile = await getCollaborationProfile(clientId, freelancerId, user.id);

  return json({
    profile: {
      ...profile,
      histories: profile.histories.map((history) => ({
        ...history,
        completedAt: history.completedAt.toISOString(),
      })),
      confirmedPreferences: profile.confirmedPreferences.map((preference) => ({
        ...preference,
        acknowledgedAt: preference.acknowledgedAt?.toISOString() ?? null,
      })),
      // Requirement 22.1 — the Client's reusable templates travel with the page.
      templates: profile.viewerRole === "CLIENT" ? await listTemplatesForClient(user.id) : [],
    },
  });
});
