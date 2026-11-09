import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { resolveRequirementsComment } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string; commentId: string }> };

export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireSession();
  const { engagementId, commentId } = await params;
  const comment = await resolveRequirementsComment(engagementId, commentId, user.id);
  return json({ comment });
});
