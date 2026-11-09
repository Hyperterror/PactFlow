import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { draftRequirements } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Returns an AI draft for review in the editor. Nothing is saved. */
export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  return json(await draftRequirements(engagementId, user.id));
});
