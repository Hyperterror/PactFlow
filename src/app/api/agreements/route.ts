import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { listAgreementsForUser } from "@/lib/agreements";
import { toAgreementDto } from "@/lib/serializers";

/** Requirement 9.1 — every Agreement the caller participates in, newest first. */
export const GET = handler(async () => {
  const user = await requireSession();
  const agreements = await listAgreementsForUser(user.id);
  return json({ agreements: agreements.map((agreement) => toAgreementDto(agreement)) });
});

// Agreements are no longer created directly from a quotation. Selecting a
// proposal opens an Engagement; the Agreement is created from the SOW once both
// parties approve the requirements (POST /api/engagements/:id/sow).
