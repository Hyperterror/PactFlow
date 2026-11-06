import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getQuotation, assertOwnedByFreelancer } from "@/lib/quotations";
import { requestAIDraft } from "@/lib/ai/quotation";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

/**
 * Requirements 4.6 / 4.9 — discard the current draft and ask again.
 *
 * The previous draft is moved to WITHDRAWN rather than overwritten, and the
 * third regeneration is the last one; a fourth call is rejected with
 * AI_REGENERATION_LIMIT.
 */
export const POST = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;

  const quotation = await getQuotation(quotationId);
  assertOwnedByFreelancer(quotation, user.id);

  const result = await requestAIDraft(quotation.briefId, user.id, { regenerate: true });

  return json(
    {
      quotation: toQuotationDto(result.quotation),
      previousQuotationId: quotation.id,
      form: result.outcome.form,
      notice: result.outcome.notice,
      engine: result.outcome.engine,
      latencyMs: result.outcome.latencyMs,
      generated: result.outcome.generated,
      failure: result.outcome.failure,
      regenerationCount: result.regenerationCount,
      regenerationsRemaining: result.regenerationsRemaining,
    },
    201,
  );
});
