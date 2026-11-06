import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import {
  LineItemSchema,
  createDraftQuotation,
  listOwnQuotations,
  listQuotationsForBrief,
} from "@/lib/quotations";
import { toQuotationDto } from "@/lib/serializers";

const QuerySchema = z.object({ briefId: z.string().min(1).optional() });

const CreateDraftBodySchema = z.object({
  briefId: z.string().min(1, "briefId is required."),
  lineItems: z.array(LineItemSchema).min(1).max(50).optional(),
  timelineDays: z.coerce.number().int().min(1).max(3650).optional(),
  notes: z.string().trim().max(5000).optional(),
});

/**
 * Requirement 6.1 — `?briefId=` returns the owning Client's submitted
 * quotations for that Brief; otherwise the Freelancer's own quotations.
 */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { briefId } = parseQuery(req, QuerySchema);

  if (briefId) {
    const quotations = await listQuotationsForBrief(briefId, user.id);
    return json({ quotations: quotations.map((quotation) => toQuotationDto(quotation)) });
  }

  const quotations = await listOwnQuotations(user.id);
  return json({ quotations: quotations.map((quotation) => toQuotationDto(quotation)) });
});

/**
 * Requirement 4.8 — the manual fallback used when AI drafting is unavailable.
 * Creating a draft requires an ACCEPTED invitation (enforced in the library).
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const input = await parseJson(req, CreateDraftBodySchema);
  const quotation = await createDraftQuotation(user.id, input.briefId, {
    lineItems: input.lineItems,
    timelineDays: input.timelineDays,
    notes: input.notes,
  });
  return json({ quotation: toQuotationDto(quotation) }, 201);
});
