import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { handleWebhookEvent } from "@/lib/webhooks";
import { deliverPending } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Requirement 18.1–18.7 — PayPal webhook receiver.
 *
 * The raw body is read as text so the signature can be verified byte-for-byte.
 * Duplicate event ids are acknowledged with HTTP 200 and never re-applied.
 * No authentication is required: authenticity comes from the signature.
 */
export const POST = handler(async (req: NextRequest) => {
  const rawBody = await req.text();
  const result = await handleWebhookEvent(rawBody, req.headers);

  // Delivery happens after the acknowledgement. Guaranteed notifications retry
  // with backoff, so awaiting them here would hold PayPal's response open and
  // invite a retry that we would then have to de-duplicate.
  if (result.action === "processed") {
    void deliverPending().catch((error) => console.error("[webhook] notification dispatch failed", error));
  }

  return json(
    {
      received: result.status < 400,
      action: result.action,
      eventId: result.eventId ?? null,
      reason: result.reason ?? null,
    },
    result.status,
  );
});
