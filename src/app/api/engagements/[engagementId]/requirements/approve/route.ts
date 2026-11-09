import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { ApproveSchema, approveRequirements } from "@/lib/engagements";

type Params = { params: Promise<{ engagementId: string }> };

/** Approves one exact version on the caller's side. Idempotent. */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { engagementId } = await params;
  const { versionNumber } = await parseJson(req, ApproveSchema);
  const result = await approveRequirements(engagementId, user.id, versionNumber);
  return json({ status: result.engagement.status, baselineApproved: result.baselineApproved });
});
