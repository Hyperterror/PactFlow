import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getEngagementDetail, toEngagementDto } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Engagement, selected proposal, discovery thread and requirements history. Participants only. */
export const GET = handler(async (_req: Request, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const detail = await getEngagementDetail(engagementId, user.id);
  return json({ ...detail, engagement: toEngagementDto(detail.engagement) });
});
