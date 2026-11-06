import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { handleWebhookEvent } from "@/lib/webhooks";
import { computeDevSignature } from "@/lib/webhooks/verifier";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture } from "../helpers/fixtures";

/**
 * **Property 6: Webhook Idempotency**
 * **Validates: Requirements 18.4, 18.5, 27.6**
 *
 * PayPal retries deliveries, so the same event id may arrive many times. The
 * first delivery reconciles the payment; every later delivery must be
 * acknowledged with HTTP 200 and must change no payment state, no notification
 * and no audit trail beyond the documented duplicate marker.
 */

function signed(body: string): Headers {
  return new Headers({ "x-pactflow-signature": computeDevSignature(body) });
}

function captureEvent(eventId: string, orderId: string, amount: string): string {
  return JSON.stringify({
    id: eventId,
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: `CAPTURE-${eventId}`,
      status: "COMPLETED",
      amount: { value: amount, currency_code: "USD" },
      supplementary_data: { related_ids: { order_id: orderId } },
    },
  });
}

async function nonDuplicateAuditCount(): Promise<number> {
  return prisma.auditLog.count({ where: { eventType: { not: "WEBHOOK_DUPLICATE" } } });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("Property 6 — webhook idempotency", () => {
  it("processes a repeated event id exactly once and acknowledges the retries", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.integer({ min: 1, max: 3 }), async (eventId, retries) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({
          milestones: [{ status: "PENDING", paymentStatus: "PENDING" }],
        });
        const milestoneId = fixture.milestoneIds[0];
        const payment = await prisma.payment.findUniqueOrThrow({ where: { milestoneId } });
        const body = captureEvent(eventId, payment.paypalOrderId!, "2000.00");

        const first = await handleWebhookEvent(body, signed(body));
        expect(first.status).toBe(200);
        expect(first.action).toBe("processed");

        const afterFirst = {
          paymentStatus: (await prisma.payment.findUniqueOrThrow({ where: { milestoneId } })).status,
          audit: await nonDuplicateAuditCount(),
          notifications: await prisma.notification.count(),
          events: await prisma.webhookEvent.count(),
        };
        expect(afterFirst.paymentStatus).toBe("CAPTURED");
        expect(afterFirst.events).toBe(1);

        for (let attempt = 0; attempt < retries; attempt += 1) {
          const duplicate = await handleWebhookEvent(body, signed(body));
          expect(duplicate.status).toBe(200);
          expect(duplicate.action).toBe("duplicate");
        }

        expect({
          paymentStatus: (await prisma.payment.findUniqueOrThrow({ where: { milestoneId } })).status,
          audit: await nonDuplicateAuditCount(),
          notifications: await prisma.notification.count(),
          events: await prisma.webhookEvent.count(),
        }).toEqual(afterFirst);
      }),
      { numRuns: 100 },
    );
  });

  it("treats a re-signed payload with the same event id as a duplicate", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (eventId) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({
          milestones: [{ status: "PENDING", paymentStatus: "PENDING" }],
        });
        const payment = await prisma.payment.findUniqueOrThrow({
          where: { milestoneId: fixture.milestoneIds[0] },
        });

        const body = captureEvent(eventId, payment.paypalOrderId!, "2000.00");
        expect((await handleWebhookEvent(body, signed(body))).action).toBe("processed");

        // Same id, different whitespace and therefore a different signature.
        const reposted = `${JSON.stringify(JSON.parse(body), null, 2)}`;
        const second = await handleWebhookEvent(reposted, signed(reposted));
        expect(second.status).toBe(200);
        expect(second.action).toBe("duplicate");
        expect(await prisma.webhookEvent.count()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects an unsigned delivery without touching application state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (eventId) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({
          milestones: [{ status: "PENDING", paymentStatus: "PENDING" }],
        });
        const milestoneId = fixture.milestoneIds[0];
        const payment = await prisma.payment.findUniqueOrThrow({ where: { milestoneId } });
        const body = captureEvent(eventId, payment.paypalOrderId!, "2000.00");

        const result = await handleWebhookEvent(body, new Headers());
        expect(result.status).toBe(400);
        expect(result.action).toBe("rejected");
        expect((await prisma.payment.findUniqueOrThrow({ where: { milestoneId } })).status).toBe(
          "PENDING",
        );
      }),
      { numRuns: 100 },
    );
  });
});
