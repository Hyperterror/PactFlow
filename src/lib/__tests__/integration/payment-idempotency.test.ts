import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { initiatePayment } from "@/lib/payments";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture } from "../helpers/fixtures";

/**
 * **Property 7: Idempotent PayPal Order Creation**
 * **Validates: Requirements 16.2, 27.7**
 *
 * The Payment row — and the PayPal order behind it — is created once per
 * milestone attempt. Retrying `initiatePayment` any number of times reuses the
 * stored idempotency key and the stored order, so the database can never hold a
 * second Payment or a second order for the same milestone.
 */

beforeEach(async () => {
  await resetDatabase();
});

describe("Property 7 — idempotent order creation", () => {
  it("keeps exactly one Payment per milestone however many times it is retried", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (attempts) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({
          milestones: [{ status: "APPROVED" }],
        });
        const milestoneId = fixture.milestoneIds[0];

        const results = [];
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          results.push(await initiatePayment(milestoneId, fixture.client.id));
        }

        expect(new Set(results.map((result) => result.payment.id)).size).toBe(1);
        expect(new Set(results.map((result) => result.approveUrl)).size).toBe(1);
        expect(new Set(results.map((result) => result.payment.idempotencyKey)).size).toBe(1);
        expect(await prisma.payment.count({ where: { milestoneId } })).toBe(1);

        // Exactly one PAYMENT_INITIATED entry for the one Payment row.
        expect(
          await prisma.auditLog.count({
            where: { resourceId: results[0].payment.id, eventType: "PAYMENT_INITIATED" },
          }),
        ).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("never shares an idempotency key or a PayPal order between milestones", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (milestones) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({
          milestones: Array.from({ length: milestones }, () => ({ status: "APPROVED" as const })),
        });

        const payments = [];
        for (const milestoneId of fixture.milestoneIds) {
          const result = await initiatePayment(milestoneId, fixture.client.id);
          payments.push(result.payment);
        }

        expect(new Set(payments.map((payment) => payment.idempotencyKey)).size).toBe(milestones);
        expect(new Set(payments.map((payment) => payment.paypalOrderId)).size).toBe(milestones);
        expect(await prisma.payment.count()).toBe(milestones);
      }),
      { numRuns: 100 },
    );
  });

  it("persists the order and the idempotency key before returning the approve URL", async () => {
    const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED" }] });
    const milestoneId = fixture.milestoneIds[0];

    const result = await initiatePayment(milestoneId, fixture.client.id);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { milestoneId } });

    expect(stored.paypalOrderId).toBe(result.payment.paypalOrderId);
    expect(stored.approveUrl).toBe(result.approveUrl);
    expect(stored.idempotencyKey.length).toBeGreaterThan(0);
    expect(stored.status).toBe("PENDING");
    expect(result.approveUrl).not.toBe("");
  });

  it("refuses to restart a payment that was already captured", async () => {
    const fixture = await createAgreementFixture({
      milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
    });

    await expect(
      initiatePayment(fixture.milestoneIds[0], fixture.client.id),
    ).rejects.toMatchObject({ status: 409, currentState: "CAPTURED" });
  });
});
