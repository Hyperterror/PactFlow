import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { assertOwnedByFreelancer, getQuotationWithBrief } from "@/lib/quotations";
import { pricingEditorView, recommendPricingForQuotation } from "@/lib/ai/pricing";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

const RecommendSchema = z.object({
  persist: z.boolean().optional(),
});

/**
 * Requirements 5.1–5.7 — per-line-item pricing recommendations displayed
 * alongside the editable price field. Dismissed items are omitted entirely.
 */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;

  const quotation = await getQuotationWithBrief(quotationId);
  assertOwnedByFreelancer(quotation, user.id);

  const items = await pricingEditorView(quotationId, user.id, {
    min: Number(quotation.brief.budgetMin),
    max: Number(quotation.brief.budgetMax),
  });
  return json({ items, quotation: toQuotationDto(quotation) });
});

/** Recomputes and persists the recommendation metadata (never the price). */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const { persist } = await parseJson(req, RecommendSchema);

  const quotation = await getQuotationWithBrief(quotationId);
  assertOwnedByFreelancer(quotation, user.id);

  const recommendations = await recommendPricingForQuotation(quotationId, user.id, {
    briefBudgetMin: Number(quotation.brief.budgetMin),
    briefBudgetMax: Number(quotation.brief.budgetMax),
    persist: persist ?? true,
  });

  return json({ recommendations });
});
