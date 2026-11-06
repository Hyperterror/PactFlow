import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { requestAIDraft } from "@/lib/ai/quotation";
import { toQuotationDto } from "@/lib/serializers";

const DraftSchema = z.object({
  briefId: z.string().min(1, "briefId is required."),
});

/**
 * Requirements 4.1–4.9 — requests the AI draft for a Brief.
 *
 * The draft is persisted with status `AI_DRAFT`, the AI-generated values are
 * kept in `aiDraftSnapshot`, and a failed or underspecified generation falls
 * back to the empty form with an explanatory notice instead of guessing.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { briefId } = await parseJson(req, DraftSchema);
  const result = await requestAIDraft(briefId, user.id);

  return json(
    {
      quotation: toQuotationDto(result.quotation),
      form: result.outcome.form,
      notice: result.outcome.notice,
      engine: result.outcome.engine,
      latencyMs: result.outcome.latencyMs,
      generated: result.outcome.generated,
      failure: result.outcome.failure,
      pricingInsufficientData: result.outcome.pricingInsufficientData,
      regenerationCount: result.regenerationCount,
      regenerationsRemaining: result.regenerationsRemaining,
    },
    201,
  );
});
