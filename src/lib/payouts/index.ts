import type { Payout, PayoutStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getSystemActorId, withTransaction, writeAuditLog, type AuditEventType } from "@/lib/audit";
import { recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";
import { createPayout, getPayoutBatch, PayPalError, type PayPalPayout } from "@/lib/payments/paypal-client";

/**
 * Freelancer payouts — the second half of a two-sided payment.
 *
 * The Client's milestone payment is captured to the platform's PayPal account.
 * Only after that capture is VERIFIED (status COMPLETED, amount and currency
 * equal to what was expected — see `evaluateCapture`) does the platform send
 * the Freelancer's share with the PayPal Payouts API. A payment in
 * REVIEW_REQUIRED, FAILED or PENDING never produces a payout.
 *
 * Safety rules:
 *  - One Payout row per Payment (unique `paymentId`), created before PayPal is
 *    called, so concurrent triggers (the capture response and the webhook)
 *    converge on one record.
 *  - `senderBatchId` is also sent as `PayPal-Request-Id`. A retry after a lost
 *    response reuses it and PayPal returns the original batch, so it cannot pay
 *    twice. A new id is used only after PayPal reported a final failure.
 *  - SUCCEEDED is terminal; nothing moves a paid payout anywhere else.
 */

export const PAYOUT_NOTE = "Your PactFlow milestone payment, released after the Client's PayPal capture was verified.";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Gross → platform fee + Freelancer amount, in cents-exact money. */
export function computePayoutSplit(gross: number, feePercent: number): { fee: number; amount: number } {
  const percent = Math.min(50, Math.max(0, Number.isFinite(feePercent) ? feePercent : 0));
  const fee = roundMoney((gross * percent) / 100);
  return { fee, amount: roundMoney(gross - fee) };
}

/** PayPal payout item `transaction_status` → PactFlow payout status. */
export function mapPayoutItemStatus(status: string | null | undefined): PayoutStatus {
  switch ((status ?? "").toUpperCase()) {
    case "SUCCESS":
      return "SUCCEEDED";
    case "UNCLAIMED":
      return "UNCLAIMED";
    case "FAILED":
    case "RETURNED":
    case "BLOCKED":
    case "DENIED":
    case "REFUNDED":
    case "REVERSED":
    case "CANCELED":
      return "FAILED";
    default:
      // PENDING, ONHOLD, NEW, or not listed yet.
      return "PENDING";
  }
}

const AUDIT_FOR_STATUS: Partial<Record<PayoutStatus, AuditEventType>> = {
  SUCCEEDED: "PAYOUT_SUCCEEDED",
  UNCLAIMED: "PAYOUT_UNCLAIMED",
  FAILED: "PAYOUT_FAILED",
};

function senderBatchIdFor(paymentId: string, attempt: number): string {
  // ≤ 127 chars per PayPal; deterministic per attempt.
  return attempt <= 1 ? `PF-${paymentId}` : `PF-${paymentId}-${attempt}`;
}

export interface PayoutOutcome {
  payout: Payout | null;
  reason?: string;
}

/**
 * Creates (or advances) the payout for one captured payment. Never throws: a
 * payout problem must not undo or hide a successful capture. Failures are
 * recorded on the Payout row and in the audit log.
 */
export async function releasePayoutForPayment(paymentId: string): Promise<PayoutOutcome> {
  try {
    return await releaseOrThrow(paymentId);
  } catch (error) {
    console.error("[payouts] release failed", {
      paymentId,
      detail: error instanceof Error ? error.message : String(error),
    });
    return { payout: await prisma.payout.findUnique({ where: { paymentId } }), reason: "ERROR" };
  }
}

async function releaseOrThrow(paymentId: string): Promise<PayoutOutcome> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { milestone: { include: { agreement: true } } },
  });
  if (!payment) return { payout: null, reason: "NO_PAYMENT" };
  if (payment.status !== "CAPTURED" || payment.amountCaptured === null) {
    // The gate: unverified money is never paid out.
    return { payout: null, reason: "PAYMENT_NOT_CAPTURED" };
  }

  const freelancerId = payment.milestone.agreement.freelancerId;
  const gross = Number(payment.amountCaptured);
  const currency = payment.currencyCaptured ?? payment.currency;
  const { fee, amount } = computePayoutSplit(gross, env.platformFeePercent);

  let payout = await prisma.payout.findUnique({ where: { paymentId } });
  if (!payout) {
    const actorId = await getSystemActorId();
    // The unique paymentId makes a concurrent second create throw; the caller's
    // guard (`releasePayoutForPayment`) then returns the row the first one made.
    payout = await withTransaction(async (tx) => {
      const created = await tx.payout.create({
        data: {
          paymentId,
          milestoneId: payment.milestoneId,
          freelancerId,
          status: "AWAITING_RECEIVER",
          grossAmount: gross,
          platformFee: fee,
          amount,
          currency,
          senderBatchId: senderBatchIdFor(paymentId, 1),
        },
      });
      await writeAuditLog(tx, {
        eventType: "PAYOUT_CREATED",
        actorId,
        resourceId: created.id,
        resourceType: "Payout",
        previousState: null,
        newState: "AWAITING_RECEIVER",
        metadata: { paymentId, gross, platformFee: fee, amount, currency, feePercent: env.platformFeePercent },
      });
      return created;
    });
  }

  if (payout.status === "SUCCEEDED" || payout.status === "UNCLAIMED") return { payout, reason: "ALREADY_SENT" };
  if (payout.status === "PENDING" && payout.paypalBatchId) return { payout, reason: "IN_FLIGHT" };
  if (payout.status === "FAILED" && payout.paypalBatchId) {
    // A final failure needs an explicit retry (new batch id), not a silent loop.
    return { payout, reason: "FAILED_NEEDS_RETRY" };
  }

  const freelancer = await prisma.user.findUniqueOrThrow({
    where: { id: freelancerId },
    select: { paypalPayoutEmail: true },
  });
  if (!freelancer.paypalPayoutEmail) {
    if (payout.attempts === 0 && !payout.lastError) {
      await prisma.payout.update({
        where: { id: payout.id },
        data: { lastError: "Waiting for the Freelancer to add a PayPal payout email." },
      });
      await send({
        userId: freelancerId,
        type: "PAYOUT_ACCOUNT_NEEDED",
        payload: { payoutId: payout.id, milestoneId: payment.milestoneId, amount, currency },
      });
    }
    return { payout: await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } }), reason: "AWAITING_RECEIVER" };
  }

  return submit(payout, freelancer.paypalPayoutEmail);
}

async function submit(payout: Payout, receiverEmail: string): Promise<PayoutOutcome> {
  const actorId = await getSystemActorId();
  const attempt = Math.max(1, payout.attempts + (payout.paypalBatchId ? 1 : 0));
  const senderBatchId = senderBatchIdFor(payout.paymentId, attempt);

  await prisma.payout.update({
    where: { id: payout.id },
    data: { receiverEmail, senderBatchId, attempts: attempt, submittedAt: new Date() },
  });

  let batch: PayPalPayout;
  try {
    batch = await createPayout({
      senderBatchId,
      receiverEmail,
      amount: Number(payout.amount).toFixed(2),
      currency: payout.currency,
      note: PAYOUT_NOTE,
    });
    // The create response does not carry the item; read it back once.
    if (!batch.itemId && batch.batchId) batch = await getPayoutBatch(batch.batchId, senderBatchId);
  } catch (error) {
    // The call itself failed: PayPal may or may not have the batch. Keep the
    // same sender batch id so a retry is idempotent, and say what happened.
    const detail = error instanceof PayPalError ? JSON.stringify(error.payload ?? null) : String(error);
    const updated = await withTransaction(async (tx) => {
      const row = await tx.payout.update({
        where: { id: payout.id },
        data: { status: "FAILED", lastError: `Payout request failed: ${detail}`.slice(0, 2000) },
      });
      await writeAuditLog(tx, {
        eventType: "PAYOUT_FAILED",
        actorId,
        resourceId: payout.id,
        resourceType: "Payout",
        previousState: payout.status,
        newState: "FAILED",
        metadata: { stage: "CREATE_CALL", senderBatchId },
      });
      return row;
    });
    return { payout: updated, reason: "REQUEST_FAILED" };
  }

  const status = mapPayoutItemStatus(batch.itemStatus);
  const updated = await applyStatus(payout.id, status, {
    paypalBatchId: batch.batchId || null,
    paypalItemId: batch.itemId,
    paypalStatus: batch.itemStatus ?? batch.batchStatus,
    lastError: status === "FAILED" ? batch.errorMessage ?? "PayPal reported the payout as failed." : null,
    actorId,
    submitted: true,
  });
  return { payout: updated };
}

/** Writes a status change with its audit entry and the Freelancer notification. */
async function applyStatus(
  payoutId: string,
  status: PayoutStatus,
  evidence: {
    paypalBatchId?: string | null;
    paypalItemId?: string | null;
    paypalStatus?: string | null;
    lastError?: string | null;
    actorId: string;
    submitted?: boolean;
  },
): Promise<Payout> {
  return withTransaction(async (tx) => {
    const current = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (current.status === "SUCCEEDED" && status !== "SUCCEEDED") {
      // Money already reached the Freelancer; a later reversal is an operator matter.
      console.error("[payouts] refusing to move a SUCCEEDED payout", { payoutId, status });
      return current;
    }
    const data: Prisma.PayoutUpdateInput = {
      status,
      paypalStatus: evidence.paypalStatus ?? current.paypalStatus,
      lastError: evidence.lastError === undefined ? current.lastError : evidence.lastError,
      ...(evidence.paypalBatchId ? { paypalBatchId: evidence.paypalBatchId } : {}),
      ...(evidence.paypalItemId ? { paypalItemId: evidence.paypalItemId } : {}),
      ...(status === "SUCCEEDED" && !current.completedAt ? { completedAt: new Date() } : {}),
    };
    const updated = await tx.payout.update({ where: { id: payoutId }, data });

    if (evidence.submitted) {
      await writeAuditLog(tx, {
        eventType: "PAYOUT_SUBMITTED",
        actorId: evidence.actorId,
        resourceId: payoutId,
        resourceType: "Payout",
        previousState: current.status,
        newState: "PENDING",
        metadata: {
          senderBatchId: current.senderBatchId,
          paypalBatchId: evidence.paypalBatchId,
          amount: Number(current.amount),
          currency: current.currency,
        },
      });
    }
    const finalEvent = AUDIT_FOR_STATUS[status];
    if (finalEvent && current.status !== status) {
      await writeAuditLog(tx, {
        eventType: finalEvent,
        actorId: evidence.actorId,
        resourceId: payoutId,
        resourceType: "Payout",
        previousState: current.status,
        newState: status,
        metadata: { paypalItemId: evidence.paypalItemId ?? current.paypalItemId, paypalStatus: evidence.paypalStatus },
      });
      await send(
        {
          userId: current.freelancerId,
          type: status === "FAILED" ? "PAYOUT_FAILED" : "PAYOUT_SENT",
          payload: {
            payoutId,
            milestoneId: current.milestoneId,
            amount: Number(current.amount),
            currency: current.currency,
            status,
          },
          guaranteed: true,
        },
        tx,
      );
    }
    return updated;
  });
}

// ─── Freelancer payout account ────────────────────────────────────────────────

export const PayoutAccountSchema = z.object({
  paypalPayoutEmail: z.string().trim().toLowerCase().email("Enter the email of your PayPal account.").max(254),
});

/**
 * Saves where the Freelancer is paid, then releases any payout that was only
 * waiting for it. Changing the email never redirects a payout already sent.
 */
export async function setPayoutAccount(userId: string, email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await withTransaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { paypalPayoutEmail: email } });
    await writeAuditLog(tx, {
      eventType: "PAYOUT_ACCOUNT_UPDATED",
      actorId: userId,
      resourceId: userId,
      resourceType: "User",
      previousState: user.paypalPayoutEmail ? "SET" : null,
      newState: "SET",
    });
  });
  const waiting = await prisma.payout.findMany({ where: { freelancerId: userId, status: "AWAITING_RECEIVER" } });
  const released: PayoutOutcome[] = [];
  for (const payout of waiting) released.push(await releasePayoutForPayment(payout.paymentId));
  return { email, released: released.length };
}

// ─── Reads, refresh and retry ─────────────────────────────────────────────────

async function payoutForParticipant(payoutId: string, userId: string) {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { payment: { select: { clientId: true } } },
  });
  if (!payout) throw new NotFoundError("Payout");
  if (payout.freelancerId !== userId && payout.payment.clientId !== userId) {
    await recordAccessViolation({ actorId: userId, resourceId: payoutId, resourceType: "Payout", reason: "NOT_PAYOUT_PARTY" });
    throw new ForbiddenError("NOT_PAYOUT_PARTY", "Only the Client and Freelancer on this milestone can see its payout.");
  }
  return payout;
}

/** Asks PayPal for the current item status (used when no webhook has arrived yet). */
export async function refreshPayout(payoutId: string, userId: string): Promise<Payout> {
  const payout = await payoutForParticipant(payoutId, userId);
  if (!payout.paypalBatchId) return payout;
  if (payout.status === "SUCCEEDED") return payout;
  const batch = await getPayoutBatch(payout.paypalBatchId, payout.senderBatchId);
  return applyStatus(payout.id, mapPayoutItemStatus(batch.itemStatus), {
    paypalItemId: batch.itemId,
    paypalStatus: batch.itemStatus ?? batch.batchStatus,
    lastError: batch.errorMessage,
    actorId: userId,
  });
}

/**
 * Retries a payout PayPal reported as FAILED (for example after the Freelancer
 * fixed their PayPal email). Uses a fresh sender batch id, as PayPal requires.
 */
export async function retryPayout(payoutId: string, userId: string): Promise<PayoutOutcome> {
  const payout = await payoutForParticipant(payoutId, userId);
  if (payout.freelancerId !== userId) {
    throw new ForbiddenError("NOT_PAYOUT_RECEIVER", "Only the Freelancer being paid can retry their payout.");
  }
  if (payout.status !== "FAILED") {
    throw new ConflictError("PAYOUT_NOT_RETRYABLE", "Only a failed payout can be retried.", payout.status);
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { paypalPayoutEmail: true } });
  if (!user.paypalPayoutEmail) {
    throw new ConflictError("PAYOUT_ACCOUNT_MISSING", "Add your PayPal payout email first.");
  }
  return submit(payout, user.paypalPayoutEmail);
}

/** PAYMENT.PAYOUTS-ITEM.* webhooks. Returns false when the payout is unknown. */
export async function reconcilePayoutWebhook(input: {
  eventType: string;
  payoutItemId: string | null;
  payoutBatchId: string | null;
  transactionStatus: string | null;
}): Promise<boolean> {
  const payout =
    (input.payoutItemId ? await prisma.payout.findUnique({ where: { paypalItemId: input.payoutItemId } }) : null) ??
    (input.payoutBatchId ? await prisma.payout.findUnique({ where: { paypalBatchId: input.payoutBatchId } }) : null);
  if (!payout) return false;

  // The event name is authoritative, e.g. PAYMENT.PAYOUTS-ITEM.SUCCEEDED.
  const suffix = input.eventType.split(".").pop() ?? "";
  const fromEvent = suffix === "SUCCEEDED" ? "SUCCESS" : suffix === "HELD" ? "ONHOLD" : suffix === "CANCELED" ? "CANCELED" : suffix;
  const status = mapPayoutItemStatus(input.transactionStatus ?? fromEvent);
  await applyStatus(payout.id, status, {
    paypalItemId: input.payoutItemId,
    paypalStatus: input.transactionStatus ?? fromEvent,
    lastError: status === "FAILED" ? `PayPal reported ${input.eventType}` : null,
    actorId: await getSystemActorId(),
  });
  return true;
}

/** Scheduled job: re-reads payouts PayPal has not finished, in case a webhook was missed. */
export async function refreshPendingPayouts(olderThanMs = 5 * 60_000): Promise<number> {
  const stale = await prisma.payout.findMany({
    where: { status: { in: ["PENDING", "UNCLAIMED"] }, paypalBatchId: { not: null }, updatedAt: { lt: new Date(Date.now() - olderThanMs) } },
    take: 50,
  });
  const actorId = await getSystemActorId();
  let changed = 0;
  for (const payout of stale) {
    try {
      const batch = await getPayoutBatch(payout.paypalBatchId!, payout.senderBatchId);
      const status = mapPayoutItemStatus(batch.itemStatus);
      if (status !== payout.status) {
        await applyStatus(payout.id, status, {
          paypalItemId: batch.itemId,
          paypalStatus: batch.itemStatus,
          lastError: batch.errorMessage,
          actorId,
        });
        changed += 1;
      }
    } catch (error) {
      console.error("[payouts] refresh failed", { payoutId: payout.id, detail: String(error) });
    }
  }
  return changed;
}

export async function getPayoutForMilestone(milestoneId: string) {
  return prisma.payout.findFirst({ where: { milestoneId } });
}

export function toPayoutDto(payout: Payout) {
  return {
    id: payout.id,
    status: payout.status,
    grossAmount: Number(payout.grossAmount),
    platformFee: Number(payout.platformFee),
    amount: Number(payout.amount),
    currency: payout.currency,
    paypalBatchId: payout.paypalBatchId,
    paypalItemId: payout.paypalItemId,
    paypalStatus: payout.paypalStatus,
    lastError: payout.lastError,
    submittedAt: payout.submittedAt?.toISOString() ?? null,
    completedAt: payout.completedAt?.toISOString() ?? null,
  };
}
