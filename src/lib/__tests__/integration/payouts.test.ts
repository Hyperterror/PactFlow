import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePayment, initiatePayment } from "@/lib/payments";
import { handleWebhookEvent } from "@/lib/webhooks";
import { computeDevSignature } from "@/lib/webhooks/verifier";
import { refreshPayout, releasePayoutForPayment, retryPayout, setPayoutAccount } from "@/lib/payouts";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture, createUser } from "../helpers/fixtures";

/**
 * Freelancer payouts, driven through the real capture path in mock PayPal mode:
 * a verified capture pays the Freelancer exactly once, an unverified one never
 * does, and PayPal's later verdicts (webhook, refresh, retry) are applied
 * without ever moving a completed payout.
 */

async function capturedMilestone(options: { withEmail?: boolean } = {}) {
  const fixture = await createAgreementFixture({ milestones: [{ status: "APPROVED" }] });
  if (options.withEmail !== false) {
    await prisma.user.update({
      where: { id: fixture.freelancer.id },
      data: { paypalPayoutEmail: "freelancer-payouts@example.test" },
    });
  }
  const { payment } = await initiatePayment(fixture.milestoneIds[0], fixture.client.id);
  await capturePayment(payment.paypalOrderId!, fixture.client.id);
  return { fixture, paymentId: payment.id, orderId: payment.paypalOrderId! };
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.PAYPAL_MOCK_PAYOUT_STATUS;
  delete process.env.PAYPAL_MOCK_CAPTURE_AMOUNT;
});

describe("payout on verified capture", () => {
  it("sends the Freelancer's share once the capture is verified", async () => {
    const { fixture, paymentId } = await capturedMilestone();
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });

    expect(payout.status).toBe("SUCCEEDED");
    expect(payout.freelancerId).toBe(fixture.freelancer.id);
    expect(payout.receiverEmail).toBe("freelancer-payouts@example.test");
    expect(Number(payout.grossAmount)).toBe(2000);
    expect(Number(payout.amount) + Number(payout.platformFee)).toBe(2000);
    expect(payout.paypalItemId).toMatch(/^MOCKITEM-/);
    expect(payout.completedAt).not.toBeNull();
    const sent = await prisma.notification.count({ where: { userId: fixture.freelancer.id, type: "PAYOUT_SENT" } });
    expect(sent).toBe(1);
  });

  it("is idempotent: repeated triggers never create or submit a second payout", async () => {
    const { paymentId } = await capturedMilestone();
    await releasePayoutForPayment(paymentId);
    await releasePayoutForPayment(paymentId);

    expect(await prisma.payout.count({ where: { paymentId } })).toBe(1);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(await prisma.auditLog.count({ where: { resourceId: payout.id, eventType: "PAYOUT_SUBMITTED" } })).toBe(1);
  });

  it("never pays out a payment held for review", async () => {
    process.env.PAYPAL_MOCK_CAPTURE_AMOUNT = "1999.99";
    const { paymentId } = await capturedMilestone();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("REVIEW_REQUIRED");

    const outcome = await releasePayoutForPayment(paymentId);
    expect(outcome).toEqual({ payout: null, reason: "PAYMENT_NOT_CAPTURED" });
    expect(await prisma.payout.count()).toBe(0);
  });

  it("waits for a payout email, then releases when the Freelancer adds one", async () => {
    const { fixture, paymentId } = await capturedMilestone({ withEmail: false });
    let payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(payout.status).toBe("AWAITING_RECEIVER");
    expect(payout.paypalBatchId).toBeNull();
    expect(
      await prisma.notification.count({ where: { userId: fixture.freelancer.id, type: "PAYOUT_ACCOUNT_NEEDED" } }),
    ).toBe(1);

    const result = await setPayoutAccount(fixture.freelancer.id, "new-account@example.test");
    expect(result.released).toBe(1);
    payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(payout.status).toBe("SUCCEEDED");
    expect(payout.receiverEmail).toBe("new-account@example.test");
  });
});

describe("failures, retries and PayPal's later verdicts", () => {
  it("records a failed payout and retries it under a new sender batch id", async () => {
    process.env.PAYPAL_MOCK_PAYOUT_STATUS = "FAILED";
    const { fixture, paymentId } = await capturedMilestone();
    const failed = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toMatch(/receiver cannot accept/);

    // Only the Freelancer being paid may retry.
    await expect(retryPayout(failed.id, fixture.client.id)).rejects.toBeInstanceOf(ForbiddenError);

    process.env.PAYPAL_MOCK_PAYOUT_STATUS = "SUCCESS";
    await retryPayout(failed.id, fixture.freelancer.id);
    const retried = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(retried.status).toBe("SUCCEEDED");
    expect(retried.senderBatchId).not.toBe(failed.senderBatchId);
    expect(retried.attempts).toBe(2);

    await expect(retryPayout(failed.id, fixture.freelancer.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("applies payout webhooks and never moves a payout that already succeeded", async () => {
    process.env.PAYPAL_MOCK_PAYOUT_STATUS = "PENDING";
    const { paymentId } = await capturedMilestone();
    const pending = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    expect(pending.status).toBe("PENDING");

    const event = (id: string, type: string, status: string) =>
      JSON.stringify({
        id,
        event_type: type,
        resource: {
          payout_item_id: pending.paypalItemId,
          payout_batch_id: pending.paypalBatchId,
          transaction_status: status,
        },
      });

    const unclaimed = event("WH-PO-1", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "UNCLAIMED");
    expect((await handleWebhookEvent(unclaimed, new Headers({ "x-pactflow-signature": computeDevSignature(unclaimed) }))).action).toBe("processed");
    expect((await prisma.payout.findUniqueOrThrow({ where: { paymentId } })).status).toBe("UNCLAIMED");

    const succeeded = event("WH-PO-2", "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS");
    await handleWebhookEvent(succeeded, new Headers({ "x-pactflow-signature": computeDevSignature(succeeded) }));
    expect((await prisma.payout.findUniqueOrThrow({ where: { paymentId } })).status).toBe("SUCCEEDED");

    const lateFailure = event("WH-PO-3", "PAYMENT.PAYOUTS-ITEM.FAILED", "FAILED");
    await handleWebhookEvent(lateFailure, new Headers({ "x-pactflow-signature": computeDevSignature(lateFailure) }));
    expect((await prisma.payout.findUniqueOrThrow({ where: { paymentId } })).status).toBe("SUCCEEDED");
  });

  it("lets only the two parties refresh a payout", async () => {
    process.env.PAYPAL_MOCK_PAYOUT_STATUS = "PENDING";
    const { fixture, paymentId } = await capturedMilestone();
    const payout = await prisma.payout.findUniqueOrThrow({ where: { paymentId } });
    const stranger = await createUser("Stranger", "stranger-payout@example.test");
    await expect(refreshPayout(payout.id, stranger.id)).rejects.toBeInstanceOf(ForbiddenError);

    process.env.PAYPAL_MOCK_PAYOUT_STATUS = "SUCCESS";
    const refreshed = await refreshPayout(payout.id, fixture.client.id);
    expect(refreshed.status).toBe("SUCCEEDED");
  });
});
