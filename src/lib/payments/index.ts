import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Payment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, ExternalServiceError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { PAYMENT_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { captureOrder, createOrder, PayPalError } from "@/lib/payments/paypal-client";
import { send } from "@/lib/notifications";
import { notifyOperators } from "@/lib/storage/signed-url";
import { maybeCompleteAgreement } from "@/lib/agreements";

export interface PaymentInitResult {
  payment: Payment;
  approveUrl: string;
}

/** Zero-tolerance amount comparison (Requirement 17.5). */
export function amountsEqual(a: string | number, b: string | number): boolean {
  try {
    return new Prisma.Decimal(a).equals(new Prisma.Decimal(b));
  } catch {
    return false;
  }
}

export function formatUsd(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

/**
 * Requirement 16 — initialises a PayPal order for an APPROVED milestone.
 *
 * The idempotency key is persisted with the Payment row before the approve URL
 * is returned, and any retry reuses the stored key so a second call can never
 * create a second order or a second Payment record (Property 7).
 */
export async function initiatePayment(milestoneId: string, clientId: string): Promise<PaymentInitResult> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { agreement: true },
  });
  if (!milestone) throw new NotFoundError("Milestone");

  const context = await assertAgreementParticipant(milestone.agreementId, clientId);
  if (context.role !== "CLIENT") {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: milestoneId,
      resourceType: "Milestone",
      reason: "WRONG_ROLE",
    });
    throw new ForbiddenError("WRONG_ROLE", "Only the Client can initiate payment.");
  }
  if (milestone.status !== "APPROVED") {
    throw new ConflictError(
      "MILESTONE_NOT_APPROVED",
      "Payment can only be initiated for an approved milestone.",
      milestone.status,
    );
  }

  const existing = await prisma.payment.findUnique({ where: { milestoneId } });

  if (existing?.status === "CAPTURED") {
    throw new ConflictError("ALREADY_PAID", "This milestone has already been paid.", existing.status);
  }
  if (existing?.paypalOrderId && existing.approveUrl) {
    // Same attempt, same order, same key.
    return { payment: existing, approveUrl: existing.approveUrl };
  }

  const idempotencyKey = existing?.idempotencyKey ?? randomUUID();
  const amount = formatUsd(milestone.paymentAmount);
  const currency = milestone.agreement.currency || "USD";

  let order;
  try {
    order = await createOrder({
      amount,
      currency,
      referenceId: milestone.id,
      idempotencyKey,
      description: `PactFlow milestone: ${milestone.name}`,
    });
  } catch (error) {
    const detail = error instanceof PayPalError ? error.payload : error;
    console.error("[payments] order creation failed", { milestoneId, idempotencyKey, detail });
    await notifyOperators({ subject: "PayPal order creation failed", milestoneId, idempotencyKey });
    throw new ExternalServiceError(
      "PAYMENT_INITIATION_FAILED",
      "Payment initiation failed. Please try again or contact support.",
    );
  }

  const payment = await withTransaction(async (tx) => {
    const saved = existing
      ? await tx.payment.update({
          where: { milestoneId },
          data: {
            paypalOrderId: order.id,
            paypalStatus: order.status,
            approveUrl: order.approveUrl,
            amountExpected: milestone.paymentAmount,
            status: "PENDING",
            lastError: null,
          },
        })
      : await tx.payment.create({
          data: {
            milestoneId,
            deliverableId: (
              await tx.deliverable.findFirst({
                where: { milestoneId },
                orderBy: { versionNumber: "desc" },
              })
            )?.id,
            agreementVersionId: milestone.agreementVersionId,
            clientId,
            status: "PENDING",
            amountExpected: milestone.paymentAmount,
            currency,
            paypalOrderId: order.id,
            paypalStatus: order.status,
            approveUrl: order.approveUrl,
            idempotencyKey,
          },
        });

    await writeAuditLog(tx, {
      eventType: "PAYMENT_INITIATED",
      actorId: clientId,
      resourceId: saved.id,
      resourceType: "Payment",
      previousState: existing?.status ?? null,
      newState: "PENDING",
      metadata: {
        milestoneId,
        paypalOrderId: order.id,
        idempotencyKey,
        amount,
        currency,
        agreementVersionId: milestone.agreementVersionId,
      },
    });
    return saved;
  });

  return { payment, approveUrl: order.approveUrl };
}

export interface CaptureResult {
  payment: Payment;
  captured: boolean;
  reviewRequired: boolean;
  reason?: string;
  /**
   * The guaranteed-delivery notifications this capture queued. Handed back rather
   * than dispatched here so the write path stays a single deterministic pass:
   * guaranteed delivery retries with backoff, and a timer fired from inside the
   * domain keeps writing to the database long after the caller believes the
   * capture is over.
   */
  notificationIds?: string[];
}

/**
 * Requirement 17 — captures the authorised payment and only then unlocks the
 * original file. The stored idempotency key is mandatory.
 */
export async function capturePayment(paypalOrderId: string, actorId: string): Promise<CaptureResult> {
  const payment = await prisma.payment.findUnique({
    where: { paypalOrderId },
    include: { milestone: { include: { agreement: true } } },
  });
  if (!payment) throw new NotFoundError("Payment");
  if (payment.clientId !== actorId) {
    await recordAccessViolation({
      actorId,
      resourceId: payment.id,
      resourceType: "Payment",
      reason: "NOT_PAYING_CLIENT",
    });
    throw new ForbiddenError("NOT_PAYING_CLIENT", "Only the paying Client can capture this payment.");
  }
  if (payment.status === "CAPTURED") {
    return { payment, captured: true, reviewRequired: false, reason: "ALREADY_CAPTURED" };
  }
  if (!payment.idempotencyKey) {
    console.error("[payments] idempotency key missing", { paymentId: payment.id });
    throw new ConflictError("IDEMPOTENCY_KEY_MISSING", "Cannot capture without the original idempotency key.");
  }

  const expectedAmount = formatUsd(payment.amountExpected);

  let capture;
  try {
    capture = await captureOrder(paypalOrderId, payment.idempotencyKey, {
      amount: expectedAmount,
      currency: payment.currency,
    });
  } catch (error) {
    const detail = error instanceof PayPalError ? error.payload : error;
    console.error("[payments] capture failed", {
      paymentId: payment.id,
      paypalOrderId,
      payload: detail,
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PENDING", lastError: JSON.stringify(detail).slice(0, 2000) },
    });
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "PAYMENT_FAILED",
        actorId,
        resourceId: payment.id,
        resourceType: "Payment",
        previousState: payment.status,
        newState: "PENDING",
        metadata: { paypalOrderId },
      });
    });
    throw new ExternalServiceError(
      "PAYMENT_CAPTURE_FAILED",
      "Payment capture failed. The original file remains locked.",
    );
  }

  if (capture.status !== "COMPLETED") {
    console.error("[payments] non-completed capture", { paymentId: payment.id, payload: capture.raw });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "PENDING", lastError: `PayPal status: ${capture.status}` },
    });
    return {
      payment: await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
      captured: false,
      reviewRequired: false,
      reason: capture.status,
    };
  }

  const amountMatches = amountsEqual(capture.amount, expectedAmount);
  if (!amountMatches) {
    // Requirement 17.5 — flag for manual review, never unlock the file.
    const flagged = await withTransaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "REVIEW_REQUIRED",
          reviewFlag: true,
          amountCaptured: capture.amount,
          captureResponse: capture.raw as Prisma.InputJsonValue,
          lastError: `Captured ${capture.amount} ${capture.currency} != expected ${expectedAmount}`,
        },
      });
      await writeAuditLog(tx, {
        eventType: "PAYMENT_REVIEW_FLAGGED",
        actorId,
        resourceId: payment.id,
        resourceType: "Payment",
        previousState: payment.status,
        newState: "REVIEW_REQUIRED",
        metadata: { captured: capture.amount, expected: expectedAmount },
      });
      return updated;
    });
    await notifyOperators({
      subject: "Payment amount mismatch",
      paymentId: payment.id,
      captured: capture.amount,
      expected: expectedAmount,
    });
    return { payment: flagged, captured: false, reviewRequired: true, reason: "AMOUNT_MISMATCH" };
  }

  const captured = await withTransaction(async (tx) => {
    assertTransition(
      PAYMENT_TRANSITIONS,
      payment.status,
      "CAPTURED",
      "PAYMENT_NOT_CAPTURABLE",
      "This payment cannot be captured from its current status.",
    );
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CAPTURED",
        capturedAt: new Date(),
        amountCaptured: capture.amount,
        captureResponse: capture.raw as Prisma.InputJsonValue,
        paypalStatus: capture.status,
        reviewFlag: false,
        lastError: null,
      },
    });
    await writeAuditLog(tx, {
      eventType: "PAYMENT_CAPTURED",
      actorId,
      resourceId: payment.id,
      resourceType: "Payment",
      previousState: payment.status,
      newState: "CAPTURED",
      metadata: { paypalOrderId, amount: capture.amount, currency: capture.currency },
    });

    const notifications = [];
    for (const userId of [payment.milestone.agreement.clientId, payment.milestone.agreement.freelancerId]) {
      notifications.push(
        await send(
          {
            userId,
            type: "PAYMENT_CAPTURED",
            payload: {
              paymentId: payment.id,
              milestoneId: payment.milestoneId,
              amount: capture.amount,
              currency: capture.currency,
            },
            guaranteed: true,
          },
          tx,
        ),
      );
    }
    return { updated, notificationIds: notifications.map((n) => n.id) };
  });

  await maybeCompleteAgreement(payment.milestone.agreementId);

  return {
    payment: await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    captured: true,
    reviewRequired: false,
    notificationIds: captured.notificationIds,
  };
}

/** Requirement 17.2 — retries reuse the original idempotency key. */
export async function retryCapture(paymentId: string, actorId: string): Promise<CaptureResult> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError("Payment");
  if (!payment.paypalOrderId) {
    throw new ConflictError("NO_PAYPAL_ORDER", "This payment has no PayPal order to capture.");
  }
  return capturePayment(payment.paypalOrderId, actorId);
}

export async function getPaymentForMilestone(milestoneId: string): Promise<Payment | null> {
  return prisma.payment.findUnique({ where: { milestoneId } });
}

export async function listPaymentsForClient(clientId: string): Promise<Payment[]> {
  return prisma.payment.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
}

/**
 * Webhook reconciliation path: mark a payment captured from a verified
 * PAYMENT.CAPTURE.COMPLETED event. Amount mismatch flags manual review.
 */
export async function reconcileCapturedPayment(input: {
  paypalOrderId: string;
  amount: string;
  currency: string;
  raw: unknown;
}): Promise<{ payment: Payment | null; changed: boolean }> {
  const payment = await prisma.payment.findUnique({ where: { paypalOrderId: input.paypalOrderId } });
  if (!payment) return { payment: null, changed: false };
  if (payment.status === "CAPTURED") return { payment, changed: false };

  const expected = formatUsd(payment.amountExpected);
  const matches = amountsEqual(input.amount, expected);

  const updated = await withTransaction(async (tx) => {
    const result = await tx.payment.update({
      where: { id: payment.id },
      data: matches
        ? {
            status: "CAPTURED",
            capturedAt: new Date(),
            amountCaptured: input.amount,
            paypalStatus: "COMPLETED",
            captureResponse: input.raw as Prisma.InputJsonValue,
            reviewFlag: false,
          }
        : {
            status: "REVIEW_REQUIRED",
            reviewFlag: true,
            amountCaptured: input.amount,
            captureResponse: input.raw as Prisma.InputJsonValue,
            lastError: `Webhook amount ${input.amount} != expected ${expected}`,
          },
    });
    await writeAuditLog(tx, {
      eventType: matches ? "PAYMENT_CAPTURED" : "PAYMENT_REVIEW_FLAGGED",
      actorId: payment.clientId,
      resourceId: payment.id,
      resourceType: "Payment",
      previousState: payment.status,
      newState: result.status,
      metadata: { source: "WEBHOOK", amount: input.amount, expected },
    });
    return result;
  });

  return { payment: updated, changed: true };
}
