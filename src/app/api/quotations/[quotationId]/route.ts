import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { QuotationEditSchema, getQuotationForViewer, saveAuditedEdit } from "@/lib/quotations";
import { openClarificationCount } from "@/lib/quotations/comments";
import { toQuotationDto } from "@/lib/serializers";

type Params = { params: Promise<{ quotationId: string }> };

/** Requirement 23.2 — the owning Client or the submitting Freelancer only. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const { quotation, viewerRole } = await getQuotationForViewer(quotationId, user.id);
  const openClarifications = await openClarificationCount(quotationId);
  return json({
    quotation: toQuotationDto(quotation),
    brief: quotation.brief,
    viewerRole,
    openClarifications,
  });
});

/**
 * Requirements 4.5 / 6.2 — edits are limited to AI_DRAFT and DRAFT states and
 * always preserve the AI-generated originals alongside the new values.
 */
export const PATCH = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { quotationId } = await params;
  const input = await parseJson(req, QuotationEditSchema);
  const quotation = await saveAuditedEdit(quotationId, user.id, input);
  return json({ quotation: toQuotationDto(quotation) });
});
