import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { createAgreementFromQuotation, listAgreementsForUser } from "@/lib/agreements";
import { toAgreementDto } from "@/lib/serializers";

const CreateAgreementSchema = z.object({
  quotationId: z.string().min(1, "quotationId is required."),
});

/** Requirement 9.1 — every Agreement the caller participates in, newest first. */
export const GET = handler(async () => {
  const user = await requireSession();
  const agreements = await listAgreementsForUser(user.id);
  return json({ agreements: agreements.map((agreement) => toAgreementDto(agreement)) });
});

/**
 * Requirement 9.2 — only the owning Client may create an Agreement, and only
 * from a SHORTLISTED quotation.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { quotationId } = await parseJson(req, CreateAgreementSchema);
  const agreement = await createAgreementFromQuotation(quotationId, user.id);
  return json({ agreement: toAgreementDto(agreement) }, 201);
});
