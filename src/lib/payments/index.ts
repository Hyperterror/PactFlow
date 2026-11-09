import { Prisma } from "@prisma/client";
import { releasePayoutForPayment } from "@/lib/payouts";
import { randomUUID } from "node:crypto";
import type { Payment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, ExternalServiceError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { PAYMENT_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { captureOrder, createOrder, PayPalError, type PayPalCapture } from "@/lib/payments/paypal-client";
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

export type CaptureOutcome =
  | { kind: "CAPTURED" }
  | { kind: "PENDING"; reason: string }
  | { kind: "FAILED"; reason: string }
  | { kind: "REVIEW"; reason: "AMOUNT_MISMATCH" | "CURRENCY_MISMATCH" | "CAPTURE_MISSING"; detail: string };

/**
 * Requirement 17.3/17.5 — the single decision on what a capture response means.
 *
 * Only a capture whose own status is COMPLETED, for exactly the expected amount
 * AND currency, unlocks the file. A PENDING capture waits for the
 * PAYMENT.CAPTURE.COMPLETED webhook; a DECLINED/FAILED capture fails the attempt;
 * anything that cannot be reconciled goes to manual review.
 */
export function evaluateCapture(
  capture: Pick<PayPalCapture, "status" | "amount" | "currency" | "captureId" | "statusReason">,
  expected: { amount: string; currency: string },
): CaptureOutcome {
  switch (capture.status) {
    case "COMPLETED":
      break;
    case "PENDING":
      return { kind: "PENDING", reason: capture.statusReason ?? "CAPTURE_PENDING" };
    case "DECLINED":
    case "FAILED":
      return { kind: "FAILED", reason: capture.statusReason ?? `CAPTURE_${capture.status}` };
    case "MISSING":
      return { kind: "REVIEW", reason: "CAPTURE_MISSING", detail: "PayPal returned no capture for this order." };
    default:
      return { kind: "REVIEW", reason: "CAPTURE_MISSING", detail: `Unexpected capture status ${capture.status}.` };
  }

  if (!capture.captureId || capture.amount === null || capture.currency === null) {
    return { kind: "REVIEW", reason: "CAPTURE_MISSING", detail: "Completed capture is missing its id or amount." };
  }
  if (capture.currency.toUpperCase() !== expected.currency.toUpperCase()) {
    return {
      kind: "REVIEW",
      reason: "CURRENCY_MISMATCH",
      detail: `Captured ${capture.amount} ${capture.currency} != expected ${expected.amount} ${expected.currency}`,
    };
  }
  if (!amountsEqual(capture.amount, expected.amount)) {
    return {
      kind: "REVIEW",
      reason: "AMOUNT_MISMATCH",
      detail: `Captured ${capture.amount} ${capture.currency} != expected ${expected.amount} ${expected.currency}`,
    };
  }
  return { kind: "CAPTURED" };
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
    // Same attempt, same order, same key. A failed capture (declined card) sends
    // the payer back through the same order, so the attempt reopens as PENDING.
    if (existing.status === "FAILED") {
      const reopened = await withTransaction(async (tx) => {
        assertTransition(
          PAYMENT_TRANSITIONS,
          existing.status,
          "PENDING",
          "PAYMENT_NOT_RETRYABLE",
          "This payment cannot be restarted from its current status.",
        );
        const updated = await tx.payment.update({
          where: { id: existing.id },
          data: { status: "PENDING", lastError: null },
        });
        await writeAuditLog(tx, {
          eventType: "PAYMENT_INITIATED",
          actorId: clientId,
          resourceId: existing.id,
          resourceType: "Payment",
          previousState: existing.status,
          newState: "PENDING",
          metadata: { milestoneId, paypalOrderId: existing.paypalOrderId, reopened: true },
        });
        return updated;
      });
      return { payment: reopened, approveUrl: existing.approveUrl };
    }
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
  if (payment.status === "FAILED") {
    // A declined capture needs a fresh approval on the same order first; that
    // goes through initiatePayment, which reopens the attempt as PENDING.
    throw new ConflictError(
      "PAYMENT_FAILED",
      "This payment attempt was declined. Start it again with PayPal.",
      payment.status,
    );
  }
  if (!payment.idempotencyKey) {
    console.error("[payments] idempotency key missing", { paymentId: payment.id });
    throw new ConflictError("IDEMPOTENCY_KEY_MISSING", "Cannot capture without the original idempotency key.");
  }

  const expected = { amount: formatUsd(payment.amountExpected), currency: payment.currency };

  let capture: PayPalCapture;
  try {
    capture = await captureOrder(paypalOrderId, payment.idempotencyKey, expected);
  } catch (error) {
    const detail = error instanceof PayPalError ? error.payload : error;
    console.error("[payments] capture failed", {
      paymentId: payment.id,
      paypalOrderId,
      payload: detail,
    });
    // The call itself failed, so nothing is known about the money: the status
    // stays where it was and the stored key makes the retry safe.
    await withTransaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { lastError: JSON.stringify(detail ?? null).slice(0, 2000) },
      });
      await writeAuditLog(tx, {
        eventType: "PAYMENT_FAILED",
        actorId,
        resourceId: payment.id,
        resourceType: "Payment",
        previousState: payment.status,
        newState: payment.status,
        metadata: { paypalOrderId, stage: "CAPTURE_CALL" },
      });
    });
    throw new ExternalServiceError(
      "PAYMENT_CAPTURE_FAILED",
      "Payment capture failed. The original file remains locked.",
    );
  }

  const outcome = evaluateCapture(capture, expected);
  const captureEvidence = {
    paypalCaptureId: capture.captureId,
    paypalStatus: capture.status,
    amountCaptured: capture.amount,
    currencyCaptured: capture.currency,
    captureResponse: capture.raw as Prisma.InputJsonValue,
  };

  if (outcome.kind === "PENDING") {
    // PayPal accepted the capture but has not settled it (e.g. eCheck, risk
    // review). The PAYMENT.CAPTURE.COMPLETED webhook finishes the job.
    console.warn("[payments] capture pending", { paymentId: payment.id, reason: outcome.reason });
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { ...captureEvidence, lastError: `Capture pending: ${outcome.reason}` },
    });
    return { payment: updated, captured: false, reviewRequired: false, reason: "CAPTURE_PENDING" };
  }

  if (outcome.kind === "FAILED") {
    const failed = await withTransaction(async (tx) => {
      assertTransition(
        PAYMENT_TRANSITIONS,
        payment.status,
        "FAILED",
        "PAYMENT_NOT_FAILABLE",
        "This payment cannot be failed from its current status.",
      );
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { ...captureEvidence, status: "FAILED", lastError: `Capture ${capture.status}: ${outcome.reason}` },
      });
      await writeAuditLog(tx, {
        eventType: "PAYMENT_FAILED",
        actorId,
        resourceId: payment.id,
        resourceType: "Payment",
        previousState: payment.status,
        newState: "FAILED",
        metadata: { paypalOrderId, captureId: capture.captureId, reason: outcome.reason },
      });
      return updated;
    });
    return { payment: failed, captured: false, reviewRequired: false, reason: outcome.reason };
  }

  if (outcome.kind === "REVIEW") {
    // Requirement 17.5 — flag for manual review, never unlock the file.
    const flagged = await withTransaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: { ...captureEvidence, status: "REVIEW_REQUIRED", reviewFlag: true, lastError: outcome.detail },
      });
      await writeAuditLog(tx, {
        eventType: "PAYMENT_REVIEW_FLAGGED",
        actorId,
        resourceId: payment.id,
        resourceType: "Payment",
        previousState: payment.status,
        newState: "REVIEW_REQUIRED",
        metadata: {
          reason: outcome.reason,
          captureId: capture.captureId,
          captured: capture.amount,
          capturedCurrency: capture.currency,
          expected: expected.amount,
          expectedCurrency: expected.currency,
        },
      });
      return updated;
    });
    await notifyOperators({
      subject: outcome.reason === "CURRENCY_MISMATCH" ? "Payment currency mismatch" : "Payment amount mismatch",
      paymentId: payment.id,
      captured: `${capture.amount ?? "?"} ${capture.currency ?? "?"}`,
      expected: `${expected.amount} ${expected.currency}`,
    });
    return { payment: flagged, captured: false, reviewRequired: true, reason: outcome.reason };
  }

  const captured = await withTransaction(async (tx) => {
    // Re-read inside the transaction: the webhook or a second tab may have
    // captured this payment while the PayPal call was in flight.
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.status === "CAPTURED") return { notificationIds: [] as string[], already: true };
    assertTransition(
      PAYMENT_TRANSITIONS,
      current.status,
      "CAPTURED",
      "PAYMENT_NOT_CAPTURABLE",
      "This payment cannot be captured from its current status.",
    );
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        ...captureEvidence,
        status: "CAPTURED",
        capturedAt: new Date(),
        reviewFlag: false,
        lastError: null,
      },
    });
    await writeAuditLog(tx, {
      eventType: "PAYMENT_CAPTURED",
      actorId,
      resourceId: payment.id,
      resourceType: "Payment",
      previousState: current.status,
      newState: "CAPTURED",
      metadata: { paypalOrderId, captureId: capture.captureId, amount: capture.amount, currency: capture.currency },
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
    return { notificationIds: notifications.map((n) => n.id), already: false };
  });

  if (!captured.already) {
    // Verified capture → pay the Freelancer's share. Never throws.
    await releasePayoutForPayment(payment.id);
    await maybeCompleteAgreement(payment.milestone.agreementId);
  }

  return {
    payment: await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }),
    captured: true,
    reviewRequired: false,
    reason: captured.already ? "ALREADY_CAPTURED" : undefined,
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
 * Webhook reconciliation path for verified PAYMENT.CAPTURE.COMPLETED and
 * PAYMENT.CAPTURE.DENIED events. Runs the same `evaluateCapture` decision as the
 * synchronous capture, so amount AND currency must match, and every status
 * change goes through the payment state table.
 */
export async function reconcileCapturedPayment(input: {
  paypalOrderId: string | null;
  captureId: string | null;
  status: string;
  amount: string | null;
  currency: string | null;
  raw: unknown;
}): Promise<{ payment: Payment | null; changed: boolean }> {
  const payment =
    (input.captureId
      ? await prisma.payment.findUnique({ where: { paypalCaptureId: input.captureId } })
      : null) ??
    (input.paypalOrderId
      ? await prisma.payment.findUnique({ where: { paypalOrderId: input.paypalOrderId } })
      : null);
  if (!payment) return { payment: null, changed: false };
  if (payment.status === "CAPTURED") return { payment, changed: false };

  const expected = { amount: formatUsd(payment.amountExpected), currency: payment.currency };
  const outcome = evaluateCapture(
    {
      status: input.status,
      captureId: input.captureId,
      amount: input.amount,
      currency: input.currency,
      statusReason: null,
    },
    expected,
  );
  if (outcome.kind === "PENDING") return { payment, changed: false };

  const target =
    outcome.kind === "CAPTURED" ? "CAPTURED" : outcome.kind === "FAILED" ? "FAILED" : "REVIEW_REQUIRED";
  if (payment.status === target) return { payment, changed: false };
  if (!(PAYMENT_TRANSITIONS[payment.status] ?? []).includes(target)) {
    // e.g. money captured on an attempt this platform already marked FAILED.
    // Never rewrite history silently — hand it to an operator.
    console.error("[payments] webhook outcome conflicts with payment state", {
      paymentId: payment.id,
      current: payment.status,
      target,
    });
    await notifyOperators({
      subject: "Webhook capture conflicts with payment state",
      paymentId: payment.id,
      current: payment.status,
      webhookStatus: input.status,
    });
    return { payment, changed: false };
  }

  const evidence = {
    paypalCaptureId: input.captureId,
    paypalStatus: input.status,
    amountCaptured: input.amount,
    currencyCaptured: input.currency,
    captureResponse: input.raw as Prisma.InputJsonValue,
  };

  const updated = await withTransaction(async (tx) => {
    const result = await tx.payment.update({
      where: { id: payment.id },
      data:
        target === "CAPTURED"
          ? { ...evidence, status: "CAPTURED", capturedAt: new Date(), reviewFlag: false, lastError: null }
          : target === "FAILED"
            ? { ...evidence, status: "FAILED", lastError: `Webhook capture ${input.status}` }
            : {
                ...evidence,
                status: "REVIEW_REQUIRED",
                reviewFlag: true,
                lastError: outcome.kind === "REVIEW" ? `Webhook: ${outcome.detail}` : null,
              },
    });
    await writeAuditLog(tx, {
      eventType:
        target === "CAPTURED" ? "PAYMENT_CAPTURED" : target === "FAILED" ? "PAYMENT_FAILED" : "PAYMENT_REVIEW_FLAGGED",
      actorId: payment.clientId,
      resourceId: payment.id,
      resourceType: "Payment",
      previousState: payment.status,
      newState: result.status,
      metadata: {
        source: "WEBHOOK",
        captureId: input.captureId,
        amount: input.amount,
        currency: input.currency,
        expected: expected.amount,
        expectedCurrency: expected.currency,
      },
    });
    return result;
  });

  if (target === "REVIEW_REQUIRED") {
    await notifyOperators({
      subject: "Webhook capture needs review",
      paymentId: payment.id,
      captured: `${input.amount ?? "?"} ${input.currency ?? "?"}`,
      expected: `${expected.amount} ${expected.currency}`,
    });
  }

  return { payment: updated, changed: true };
}
