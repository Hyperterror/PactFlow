import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { withdrawQuotation } from "@/lib/quotations";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

/** Requirement 6.4 — withdrawal is pushed to open Client views via SSE. */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const quotation = await withdrawQuotation(quotationId, user.id);
  return json({ quotation: toQuotationDto(quotation) });
});
