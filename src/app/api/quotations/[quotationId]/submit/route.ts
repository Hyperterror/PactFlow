import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { submitQuotation } from "@/lib/quotations";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

/**
 * Requirement 6.3 — submission is one-way from AI_DRAFT/DRAFT and notifies the
 * owning Client; a submitted quotation can no longer be edited.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const quotation = await submitQuotation(quotationId, user.id);
  return json({ quotation: toQuotationDto(quotation) });
});
