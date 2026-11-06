import { z } from "zod";
import type { Deliverable } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { DELIVERABLE_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";

export const MAX_REVISION_FEEDBACK_LENGTH = 5000;
export const MIN_REVISION_FEEDBACK_LENGTH = 10;
export const REVIEW_REMINDER_DAYS = 14;

export const RevisionRequestSchema = z.object({
  feedbackText: z
    .string()
    .trim()
    .min(MIN_REVISION_FEEDBACK_LENGTH, `Feedback must be at least ${MIN_REVISION_FEEDBACK_LENGTH} characters.`)
    .max(MAX_REVISION_FEEDBACK_LENGTH, `Feedback must be at most ${MAX_REVISION_FEEDBACK_LENGTH} characters.`),
});

export type RevisionRequestInput = z.infer<typeof RevisionRequestSchema>;

async function loadForClient(deliverableId: string, clientId: string) {
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    include: { milestone: { include: { agreement: true } } },
  });
  if (!deliverable) throw new NotFoundError("Deliverable");
  const context = await assertAgreementParticipant(deliverable.milestone.agreementId, clientId);
  if (context.role !== "CLIENT") {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: deliverableId,
      resourceType: "Deliverable",
      reason: "WRONG_ROLE",
    });
    throw new ForbiddenError("WRONG_ROLE", "Only the Client can review this deliverable.");
  }
  return { deliverable, agreement: deliverable.milestone.agreement };
}

/**
 * Requirement 15.2 / 15.6 / 15.7 — approval enables the payment flow but the
 * Original_File stays locked behind the payment gate.
 */
export async function approveDeliverable(deliverableId: string, clientId: string): Promise<Deliverable> {
  const { deliverable, agreement } = await loadForClient(deliverableId, clientId);
  assertTransition(
    DELIVERABLE_TRANSITIONS,
    deliverable.status,
    "APPROVED",
    "DELIVERABLE_NOT_APPROVABLE",
    "This deliverable cannot be approved from its current status.",
  );

  return withTransaction(async (tx) => {
    const updated = await tx.deliverable.update({
      where: { id: deliverableId },
      data: { status: "APPROVED" },
    });
    await writeAuditLog(tx, {
      eventType: "DELIVERABLE_APPROVED",
      actorId: clientId,
      resourceId: deliverableId,
      resourceType: "Deliverable",
      previousState: deliverable.status,
      newState: "APPROVED",
      metadata: { agreementId: agreement.id, originalFileReleased: false },
    });
    await send(
      {
        userId: deliverable.freelancerId,
        type: "DELIVERABLE_REVIEWED",
        payload: {
          deliverableId,
          milestoneId: deliverable.milestoneId,
          decision: "APPROVED",
          paymentPending: true,
        },
      },
      tx,
    );
    return updated;
  });
}

/**
 * Requirements 15.3–15.5, 15.8 — feedback must be 10–5000 characters, the
 * revision counter is tracked, and the limit blocks further requests.
 */
export async function submitRevisionRequest(
  deliverableId: string,
  clientId: string,
  feedbackText: string,
): Promise<Deliverable> {
  const { deliverable, agreement } = await loadForClient(deliverableId, clientId);

  assertTransition(
    DELIVERABLE_TRANSITIONS,
    deliverable.status,
    "REVISION_REQUESTED",
    "DELIVERABLE_NOT_REVISABLE",
    "This deliverable cannot receive a revision request from its current status.",
  );

  const limit = Math.min(Math.max(agreement.revisionLimit, 1), 10);
  if (deliverable.revisionCount >= limit) {
    throw new ConflictError(
      "REVISION_LIMIT_REACHED",
      `The revision limit (${limit}) has been reached. Approve the deliverable or open a scope-change request.`,
      deliverable.status,
    );
  }

  return withTransaction(async (tx) => {
    await tx.revisionRequest.create({
      data: { deliverableId, clientId, feedbackText },
    });
    const updated = await tx.deliverable.update({
      where: { id: deliverableId },
      data: { status: "REVISION_REQUESTED", revisionCount: { increment: 1 } },
    });
    await writeAuditLog(tx, {
      eventType: "DELIVERABLE_REVISION_REQUESTED",
      actorId: clientId,
      resourceId: deliverableId,
      resourceType: "Deliverable",
      previousState: deliverable.status,
      newState: "REVISION_REQUESTED",
      metadata: { revisionCount: updated.revisionCount, revisionLimit: limit },
    });
    await send(
      {
        userId: deliverable.freelancerId,
        type: "DELIVERABLE_REVIEWED",
        payload: {
          deliverableId,
          milestoneId: deliverable.milestoneId,
          decision: "REVISION_REQUESTED",
          feedbackText,
          revisionCount: updated.revisionCount,
          revisionLimit: limit,
        },
      },
      tx,
    );
    return updated;
  });
}

export async function listRevisionRequests(deliverableId: string) {
  return prisma.revisionRequest.findMany({
    where: { deliverableId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Requirement 15.9 — cron target: reminders for deliverables that have sat in
 * UPLOADED for 14 days without Client action.
 */
export async function remindStaleDeliverables(now: Date = new Date()): Promise<number> {
  const threshold = new Date(now.getTime() - REVIEW_REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.deliverable.findMany({
    where: { status: "UPLOADED", uploadedAt: { lte: threshold } },
    include: { milestone: { include: { agreement: true } } },
  });

  let reminded = 0;
  for (const deliverable of stale) {
    await withTransaction(async (tx) => {
      await send(
        {
          userId: deliverable.milestone.agreement.clientId,
          type: "DELIVERABLE_REMINDER",
          payload: {
            deliverableId: deliverable.id,
            milestoneId: deliverable.milestoneId,
            milestoneName: deliverable.milestone.name,
            dueDate: deliverable.milestone.dueDate.toISOString(),
            uploadedAt: deliverable.uploadedAt.toISOString(),
          },
        },
        tx,
      );
      await writeAuditLog(tx, {
        eventType: "DELIVERABLE_REVIEW_REMINDED",
        actorId: deliverable.milestone.agreement.clientId,
        resourceId: deliverable.id,
        resourceType: "Deliverable",
        previousState: "UPLOADED",
        newState: "UPLOADED",
        metadata: { reminderDays: REVIEW_REMINDER_DAYS },
      });
    });
    reminded += 1;
  }
  return reminded;
}
