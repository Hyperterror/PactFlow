import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, parseQuery } from "@/lib/http";
import { readSignedObject } from "@/lib/storage/signed-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  key: z.string().min(1),
  expires: z.coerce.number().int().positive(),
  sig: z.string().min(1),
  event: z.string().min(1).optional(),
  download: z.string().optional(),
});

/**
 * Requirements 19.1 / 19.5 — serves the bytes behind a Signed_URL.
 *
 * Authenticity comes exclusively from the HMAC signature plus the
 * `SignedUrlEvent` row (expiry and invalidation), so this endpoint is reachable
 * without a session. Storage keys are never disclosed anywhere else.
 */
export const GET = handler(async (req: NextRequest) => {
  const params = parseQuery(req, QuerySchema);
  const { buffer } = await readSignedObject({
    key: params.key,
    expires: params.expires,
    signature: params.sig,
    eventId: params.event,
  });

  const disposition = params.download === "1" ? "attachment" : "inline";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${disposition}; filename="pactflow-deliverable.pdf"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
