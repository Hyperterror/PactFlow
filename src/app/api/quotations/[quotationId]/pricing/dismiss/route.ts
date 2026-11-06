import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { dismissPricingRecommendation } from "@/lib/quotations";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

const DismissSchema = z.object({
  lineItemIndex: z.coerce.number().int().min(0),
});

/**
 * Requirement 5.8 — dismissal is permanent for that line item and never
 * affects the other recommendations.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const { lineItemIndex } = await parseJson(req, DismissSchema);
  const quotation = await dismissPricingRecommendation(quotationId, user.id, lineItemIndex);
  return json({ quotation: toQuotationDto(quotation) });
});
