import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePayment, initiatePayment } from "@/lib/payments";
import { handleWebhookEvent } from "@/lib/webhooks";
import { computeDevSignature } from "@/lib/webhooks/verifier";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture } from "../helpers/fixtures";

/**
 * Capture evidence and reconciliation (Requirements 17, 18).
 *
 * Runs the real domain modules in mock PayPal mode: the synchronous capture
 * records the capture id and currency, a second capture is a no-op, and the
 * webhook path applies the same amount-and-currency decision and the payment
 * state table.
 */

function signed(body: string): Headers {
  return new Headers({ "x-pactflow-signature": computeDevSignature(body) });
}

function captureEvent(input: {
  eventId: string;
  type?: string;
  orderId: string;
  captureId?: string;
  amount?: string;
  currency?: string;
}): string {
  return JSON.stringify({
    id: input.eventId,
    event_type: input.type ?? "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: input.captureId ?? `CAP-${input.eventId}`,
      status: "COMPLETED",
      amount: { value: input.amount ?? "2000.00", currency_code: input.currency ?? "USD" },
      supplementary_data: { related_ids: { order_id: input.orderId } },
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  // Operator alerts and capture diagnostics are deliberate; keep output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.PAYPAL_MOCK_CAPTURE_AMOUNT;
});

describe("synchronous capture", () => {
  it("stores the capture id, capture status and captured currency as evidence", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED" }] });
    const { payment } = await initiatePayment(fixture.milestoneIds[0], fixture.client.id);

    const result = await capturePayment(payment.paypalOrderId!, fixture.client.id);
    expect(result.captured).toBe(true);

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.status).toBe("CAPTURED");
    expect(stored.paypalCaptureId).toMatch(/^MOCKCAP-/);
    expect(stored.paypalStatus).toBe("COMPLETED");
    expect(stored.currencyCaptured).toBe("USD");
    expect(Number(stored.amountCaptured)).toBe(2000);
  });

  it("treats a second capture as a no-op with one audit entry and one set of notifications", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED" }] });
    const { payment } = await initiatePayment(fixture.milestoneIds[0], fixture.client.id);

    await capturePayment(payment.paypalOrderId!, fixture.client.id);
    const notificationsAfterFirst = await prisma.notification.count();
    const second = await capturePayment(payment.paypalOrderId!, fixture.client.id);

    expect(second).toMatchObject({ captured: true, reason: "ALREADY_CAPTURED" });
    expect(await prisma.auditLog.count({ where: { resourceId: payment.id, eventType: "PAYMENT_CAPTURED" } })).toBe(1);
    expect(await prisma.notification.count()).toBe(notificationsAfterFirst);
  });

  it("holds an under-capture for review and keeps the evidence", async () => {
    process.env.PAYPAL_MOCK_CAPTURE_AMOUNT = "1999.99";
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED" }] });
    const { payment } = await initiatePayment(fixture.milestoneIds[0], fixture.client.id);

    const result = await capturePayment(payment.paypalOrderId!, fixture.client.id);
    expect(result).toMatchObject({ captured: false, reviewRequired: true, reason: "AMOUNT_MISMATCH" });

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.status).toBe("REVIEW_REQUIRED");
    expect(stored.paypalCaptureId).not.toBeNull();
    expect(stored.capturedAt).toBeNull();
  });
});

describe("webhook reconciliation", () => {
  it("captures on a matching PAYMENT.CAPTURE.COMPLETED and records the capture id", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED", paymentStatus: "PENDING" }] });
    const orderId = `ORDER-${fixture.milestoneIds[0]}`;
    const body = captureEvent({ eventId: "WH-OK", orderId, captureId: "CAP-OK" });

    expect((await handleWebhookEvent(body, signed(body))).action).toBe("processed");
    const stored = await prisma.payment.findUniqueOrThrow({ where: { paypalOrderId: orderId } });
    expect(stored.status).toBe("CAPTURED");
    expect(stored.paypalCaptureId).toBe("CAP-OK");
  });

  it("holds the right amount in the wrong currency for review", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED", paymentStatus: "PENDING" }] });
    const orderId = `ORDER-${fixture.milestoneIds[0]}`;
    const body = captureEvent({ eventId: "WH-EUR", orderId, currency: "EUR" });

    await handleWebhookEvent(body, signed(body));
    const stored = await prisma.payment.findUniqueOrThrow({ where: { paypalOrderId: orderId } });
    expect(stored.status).toBe("REVIEW_REQUIRED");
    expect(stored.currencyCaptured).toBe("EUR");
    expect(stored.capturedAt).toBeNull();
  });

  it("fails the attempt on PAYMENT.CAPTURE.DENIED, and paying again reopens it", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED" }] });
    const { payment } = await initiatePayment(fixture.milestoneIds[0], fixture.client.id);
    const body = captureEvent({
      eventId: "WH-DENIED",
      type: "PAYMENT.CAPTURE.DENIED",
      orderId: payment.paypalOrderId!,
    });

    await handleWebhookEvent(body, signed(body));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("FAILED");

    await expect(capturePayment(payment.paypalOrderId!, fixture.client.id)).rejects.toMatchObject({
      status: 409,
    });

    const reopened = await initiatePayment(fixture.milestoneIds[0], fixture.client.id);
    expect(reopened.payment.status).toBe("PENDING");
    expect(reopened.payment.paypalOrderId).toBe(payment.paypalOrderId);
    expect(reopened.payment.idempotencyKey).toBe(payment.idempotencyKey);
  });

  it("never moves a CAPTURED payment, whatever arrives later", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }] });
    const orderId = `ORDER-${fixture.milestoneIds[0]}`;
    const body = captureEvent({ eventId: "WH-LATE", type: "PAYMENT.CAPTURE.DENIED", orderId });

    await handleWebhookEvent(body, signed(body));
    expect((await prisma.payment.findUniqueOrThrow({ where: { paypalOrderId: orderId } })).status).toBe("CAPTURED");
  });

  it("still processes the genuine event after a forged copy with the same id was rejected", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED", paymentStatus: "PENDING" }] });
    const orderId = `ORDER-${fixture.milestoneIds[0]}`;
    const body = captureEvent({ eventId: "WH-SAME", orderId });

    const forged = await handleWebhookEvent(body, new Headers({ "x-pactflow-signature": "forged" }));
    expect(forged.status).toBe(400);

    const genuine = await handleWebhookEvent(body, signed(body));
    expect(genuine).toMatchObject({ status: 200, action: "processed" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { paypalOrderId: orderId } })).status).toBe("CAPTURED");
    expect(await prisma.webhookEvent.count({ where: { signatureVerified: false } })).toBe(1);
  });
});
