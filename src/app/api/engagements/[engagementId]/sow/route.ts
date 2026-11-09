import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getSowPreview, submitSow } from "@/lib/engagements";
import { SowSubmitSchema } from "@/lib/engagements/sow";

type Params = { params: Promise<{ engagementId: string }> };

/** The SOW built from the approved requirements and the accepted proposal. */
export const GET = handler(async (_req: Request, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const { draft } = await getSowPreview(engagementId, user.id);
  return json({ sow: draft });
});

/** Submits the SOW: creates the Agreement at version 1, pending both approvals. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const input = await parseJson(req, SowSubmitSchema);
  const { agreementId, created } = await submitSow(engagementId, user.id, input);
  return json({ agreementId }, created ? 201 : 200);
});
