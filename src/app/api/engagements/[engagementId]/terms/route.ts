import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { DiscoveryTermsSchema, toEngagementDto, updateDiscoveryTerms } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Records whether discovery is unpaid, time-boxed or paid. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const input = await parseJson(req, DiscoveryTermsSchema);
  const engagement = await updateDiscoveryTerms(engagementId, user.id, input);
  return json({ engagement: toEngagementDto(engagement) });
});
