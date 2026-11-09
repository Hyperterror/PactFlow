import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { listEngagementSummaries } from "@/lib/engagements";

/** Every Engagement the caller takes part in, newest first. */
export const GET = handler(async () => {
  const user = await requireSession();
  return json({ engagements: await listEngagementSummaries(user.id) });
});
