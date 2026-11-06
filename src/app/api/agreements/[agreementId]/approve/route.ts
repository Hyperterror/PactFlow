import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { approveVersion } from "@/lib/agreements";
import { toAgreementDto } from "@/lib/serializers";

type Params = { params: Promise<{ agreementId: string }> };

/**
 * Requirement 9.5 — each party approves its own role at the current version.
 * The Agreement becomes ACTIVE only once both approvals exist.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const agreement = await approveVersion(agreementId, user.id);
  return json({ agreement: toAgreementDto(agreement) });
});
