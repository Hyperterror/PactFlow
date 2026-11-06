import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSystemActorId, withTransaction, writeAuditLog } from "@/lib/audit";
import { verifyWebhookSignature } from "@/lib/webhooks/verifier";
import { reconcileCapturedPayment } from "@/lib/payments";
import { maybeCompleteAgreement } from "@/lib/agreements";

export type WebhookAction = "processed" | "duplicate" | "ignored" | "rejected";

export interface WebhookHandlerResult {
  status: number;
  action: WebhookAction;
  eventId?: string;
  reason?: string;
}

interface PayPalEventShape {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    amount?: { value?: string; currency_code?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
  [key: string]: unknown;
}

function fallbackEventId(rawBody: string): string {
  return `synthetic_${createHash("sha256").update(rawBody).digest("hex").slice(0, 32)}`;
}

/**
 * Requirement 18 — verify, de-duplicate, log, dispatch, acknowledge.
 *
 * The `WebhookEvent.paypalEventId` unique constraint IS the idempotency
 * registry (design.md §13). Duplicate deliveries therefore cannot be inserted
 * into that table; they are recorded in the append-only AuditLog as
 * WEBHOOK_DUPLICATE, which preserves the same 2-year retention guarantee.
 */
export async function handleWebhookEvent(
  rawBody: string,
  headers: Headers,
): Promise<WebhookHandlerResult> {
  const verification = await verifyWebhookSignature(rawBody, headers);

  let payload: PayPalEventShape = {};
  let parsed = false;
  try {
    payload = JSON.parse(rawBody) as PayPalEventShape;
    parsed = true;
  } catch {
    parsed = false;
  }

  const eventId = (parsed && typeof payload.id === "string" && payload.id) || fallbackEventId(rawBody);
  const eventType = (parsed && typeof payload.event_type === "string" && payload.event_type) || "UNKNOWN";

  // Requirement 18.3 — bad signatures never touch application state.
  if (!verification.valid) {
    console.warn(`[webhook] rejected eventId=${eventId} reason=${verification.reason ?? "invalid signature"}`);
    await persistEvent({
      paypalEventId: eventId,
      eventType,
      rawPayload: parsed ? (payload as Prisma.InputJsonValue) : { raw: rawBody.slice(0, 5000) },
      signatureVerified: false,
      processingError: verification.reason ?? "Signature verification failed",
    });
    return { status: 400, action: "rejected", eventId, reason: verification.reason };
  }

  if (!parsed) {
    await persistEvent({
      paypalEventId: eventId,
      eventType: "UNPARSEABLE",
      rawPayload: { raw: rawBody.slice(0, 5000) },
      signatureVerified: true,
      processingError: "Payload was not valid JSON",
    });
    return { status: 400, action: "rejected", eventId, reason: "Invalid JSON payload" };
  }

  // Requirement 18.4/18.5 — duplicate event ids are acknowledged and ignored.
  const existing = await prisma.webhookEvent.findUnique({ where: { paypalEventId: eventId } });
  if (existing) {
    // Attributed to the system actor: an inbound webhook has no signed-in user.
    const actorId = await getSystemActorId();
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "WEBHOOK_DUPLICATE",
        actorId,
        resourceId: eventId,
        resourceType: "WebhookEvent",
        previousState: "PROCESSED",
        newState: "DUPLICATE_IGNORED",
        metadata: { eventType, webhookEventId: existing.id },
      });
    });
    return { status: 200, action: "duplicate", eventId };
  }

  const stored = await persistEvent({
    paypalEventId: eventId,
    eventType,
    rawPayload: payload as Prisma.InputJsonValue,
    signatureVerified: true,
  });

  try {
    const handled = await dispatchEvent(eventType, payload);
    await prisma.webhookEvent.update({
      where: { id: stored.id },
      data: { processedAt: new Date(), isDuplicate: false },
    });
    // Delivering the notifications this event produced is deliberately NOT part of
    // this function: guaranteed delivery retries with backoff, which would push the
    // acknowledgement past PayPal's budget. The receiver decides — see
    // `app/api/webhooks/paypal/route.ts`. What is left here is one deterministic
    // pass over the database, so a caller knows exactly when it has finished.
    return { status: 200, action: handled ? "processed" : "ignored", eventId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    console.error("[webhook] processing error", { eventId, message });
    await prisma.webhookEvent.update({
      where: { id: stored.id },
      data: { processingError: message.slice(0, 1000) },
    });
    return { status: 200, action: "processed", eventId, reason: message };
  }
}

async function persistEvent(data: {
  paypalEventId: string;
  eventType: string;
  rawPayload: Prisma.InputJsonValue;
  signatureVerified: boolean;
  processingError?: string;
}) {
  return prisma.webhookEvent.create({
    data: {
      paypalEventId: data.paypalEventId,
      eventType: data.eventType,
      rawPayload: data.rawPayload,
      signatureVerified: data.signatureVerified,
      processingError: data.processingError,
    },
  });
}

async function dispatchEvent(eventType: string, payload: PayPalEventShape): Promise<boolean> {
  if (eventType !== "PAYMENT.CAPTURE.COMPLETED") return false;

  const orderId = payload.resource?.supplementary_data?.related_ids?.order_id;
  const amount = payload.resource?.amount?.value;
  const currency = payload.resource?.amount?.currency_code ?? "USD";
  if (!orderId || !amount) {
    throw new Error("PAYMENT.CAPTURE.COMPLETED payload is missing order id or amount");
  }

  const { payment, changed } = await reconcileCapturedPayment({
    paypalOrderId: orderId,
    amount,
    currency,
    raw: payload,
  });

  if (!payment) {
    // Order unknown to this platform — nothing to reconcile.
    return true;
  }
  if (changed && payment.status === "CAPTURED") {
    await maybeCompleteAgreement(await agreementIdFor(payment.milestoneId));
  }
  return true;
}

async function agreementIdFor(milestoneId: string): Promise<string> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { agreementId: true },
  });
  return milestone?.agreementId ?? "";
}

/** Read-only webhook log for the operator view (Requirement 18.8). */
export async function listWebhookEvents(limit = 100) {
  return prisma.webhookEvent.findMany({
    orderBy: { receivedAt: "desc" },
    take: Math.min(limit, 500),
  });
}
