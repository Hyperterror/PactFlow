import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { shortlistQuotation } from "@/lib/quotations";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

/**
 * Requirement 6.5 — shortlisting is private to the Client. No notification is
 * emitted so the Freelancer can never infer their position.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const quotation = await shortlistQuotation(quotationId, user.id);
  return json({ quotation: toQuotationDto(quotation) });
});
