import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { issueSignedUrl } from "@/lib/storage/signed-url";
import { MAX_SIGNED_URL_SECONDS } from "@/lib/storage";

type Params = { params: Promise<{ deliverableId: string }> };

const QuerySchema = z.object({
  expirySeconds: z.coerce.number().int().min(1).max(MAX_SIGNED_URL_SECONDS).optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Requirements 19.1–19.6 — issues a time-bounded Signed_URL.
 *
 * The gate is enforced inside `issueSignedUrl`: paying Client only, payment
 * CAPTURED, stored binary hash matches the hash recorded at upload time. When
 * any gate fails the URL is withheld and the failure is audited.
 */
export const GET = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { deliverableId } = await params;
  const { expirySeconds } = parseQuery(req, QuerySchema);

  const signed = await issueSignedUrl(deliverableId, user.id, { expirySeconds });
  return json({
    url: signed.url,
    expiresAt: signed.expiresAt.toISOString(),
    deliverableId: signed.deliverableId,
    eventId: signed.eventId,
    maxExpirySeconds: MAX_SIGNED_URL_SECONDS,
  });
});
