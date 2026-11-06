import { z } from "zod";
import type { Milestone } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { MILESTONE_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";
import { maybeCompleteAgreement } from "@/lib/agreements";
import { ForbiddenError } from "@/lib/errors";

export const CreateMilestoneSchema = z.object({
  agreementId: z.string().min(1, "agreementId is required."),
  name: z.string().trim().min(1, "Name is required.").max(100, "Name must be at most 100 characters."),
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(1000, "Description must be at most 1000 characters."),
  dueDate: z.coerce.date(),
  paymentAmount: z.coerce
    .number()
    .min(0.01, "Payment amount must be at least 0.01.")
    .max(999_999_999.99, "Payment amount must be at most 999,999,999.99."),
});

export type CreateMilestoneInput = z.infer<typeof CreateMilestoneSchema>;

export async function createMilestone(actorId: string, input: CreateMilestoneInput): Promise<Milestone> {
  const context = await assertAgreementParticipant(input.agreementId, actorId);
  const agreement = context.agreement;
  if (agreement.status !== "ACTIVE") {
    throw new ConflictError(
      "AGREEMENT_NOT_ACTIVE",
      "Milestones can only be defined on an active agreement.",
      agreement.status,
    );
  }

  const startDate = agreement.startDate ?? agreement.createdAt;
  if (input.dueDate.getTime() < startDate.getTime()) {
    throw new ValidationError([
      { field: "dueDate", message: "Due date must be on or after the agreement start date." },
    ]);
  }

  return withTransaction(async (tx) => {
    const milestone = await tx.milestone.create({
      data: {
        agreementId: agreement.id,
        agreementVersionId: (
          await tx.agreementVersion.findFirstOrThrow({
            where: { agreementId: agreement.id, versionNumber: agreement.currentVersion },
          })
        ).id,
        name: input.name,
        description: input.description,
        dueDate: input.dueDate,
        paymentAmount: input.paymentAmount,
        status: "PENDING",
      },
    });
    await writeAuditLog(tx, {
      eventType: "MILESTONE_CREATED",
      actorId,
      resourceId: milestone.id,
      resourceType: "Milestone",
      previousState: null,
      newState: "PENDING",
      metadata: { agreementId: agreement.id, paymentAmount: input.paymentAmount },
    });
    return milestone;
  });
}

export async function getMilestone(milestoneId: string): Promise<Milestone> {
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError("Milestone");
  return milestone;
}

/** Loads a milestone and verifies the caller belongs to its Agreement. */
export async function getMilestoneForUser(milestoneId: string, userId: string) {
  const milestone = await getMilestone(milestoneId);
  const context = await assertAgreementParticipant(milestone.agreementId, userId);
  return { milestone, ...context };
}

/**
 * Requirement 13.3 — a milestone can only be marked DELIVERED once the
 * associated Deliverable exists in the Delivery Room.
 */
export async function markDelivered(milestoneId: string, freelancerId: string): Promise<Milestone> {
  const { milestone, role, agreement } = await getMilestoneForUser(milestoneId, freelancerId);
  if (role !== "FREELANCER") {
    await recordAccessViolation({
      actorId: freelancerId,
      resourceId: milestoneId,
      resourceType: "Milestone",
      reason: "WRONG_ROLE",
    });
    throw new ForbiddenError("WRONG_ROLE", "Only the Freelancer can mark a milestone delivered.");
  }

  const deliverable = await prisma.deliverable.findFirst({
    where: { milestoneId, status: { in: ["UPLOADED", "APPROVED"] } },
  });
  if (!deliverable) {
    throw new ConflictError(
      "DELIVERABLE_REQUIRED",
      "Upload a deliverable to the Delivery Room before marking this milestone delivered.",
      milestone.status,
    );
  }
  assertTransition(
    MILESTONE_TRANSITIONS,
    milestone.status,
    "DELIVERED",
    "MILESTONE_NOT_DELIVERABLE",
    "This milestone cannot be marked delivered.",
  );

  return withTransaction(async (tx) => {
    const updated = await tx.milestone.update({
      where: { id: milestoneId },
      data: { status: "DELIVERED", deliveredAt: new Date() },
    });
    await writeAuditLog(tx, {
      eventType: "MILESTONE_DELIVERED",
      actorId: freelancerId,
      resourceId: milestoneId,
      resourceType: "Milestone",
      previousState: milestone.status,
      newState: "DELIVERED",
    });
    await send(
      {
        userId: agreement.clientId,
        type: "DELIVERABLE_REVIEW_NEEDED",
        payload: {
          milestoneId,
          agreementId: agreement.id,
          milestoneName: milestone.name,
          deliverableId: deliverable.id,
        },
      },
      tx,
    );
    return updated;
  });
}

/** Requirement 13.5 — approving a delivery enables the payment flow. */
export async function approveDelivery(milestoneId: string, clientId: string): Promise<Milestone> {
  const { milestone, role, agreement } = await getMilestoneForUser(milestoneId, clientId);
  if (role !== "CLIENT") {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: milestoneId,
      resourceType: "Milestone",
      reason: "WRONG_ROLE",
    });
    throw new ForbiddenError("WRONG_ROLE", "Only the Client can approve a milestone delivery.");
  }
  assertTransition(
    MILESTONE_TRANSITIONS,
    milestone.status,
    "APPROVED",
    "MILESTONE_NOT_APPROVABLE",
    "This milestone cannot be approved from its current status.",
  );

  const updated = await withTransaction(async (tx) => {
    const result = await tx.milestone.update({
      where: { id: milestoneId },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    await writeAuditLog(tx, {
      eventType: "MILESTONE_APPROVED",
      actorId: clientId,
      resourceId: milestoneId,
      resourceType: "Milestone",
      previousState: milestone.status,
      newState: "APPROVED",
      metadata: { agreementId: agreement.id },
    });
    await send(
      {
        userId: agreement.freelancerId,
        type: "MILESTONE_DELIVERED",
        payload: { milestoneId, agreementId: agreement.id, milestoneName: milestone.name, approved: true },
      },
      tx,
    );
    return result;
  });

  await maybeCompleteAgreement(agreement.id);
  return updated;
}

/** Requirement 13.6 — dueDate ASC, createdAt ASC tiebreaker. */
export async function listMilestones(agreementId: string): Promise<Milestone[]> {
  return prisma.milestone.findMany({
    where: { agreementId },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Delivery index: every milestone across the user's agreements, grouped by
 * agreement so the Delivery Room list reads as projects rather than a flat feed.
 */
export async function listMilestonesForUser(userId: string) {
  const agreements = await prisma.agreement.findMany({
    where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
    orderBy: { createdAt: "desc" },
    include: {
      brief: { select: { id: true, title: true } },
      milestones: {
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        include: { payment: { select: { status: true } } },
      },
    },
  });

  return agreements.map((agreement) => ({
    agreementId: agreement.id,
    briefId: agreement.briefId,
    title: agreement.brief.title,
    status: agreement.status,
    currency: agreement.currency,
    revisionLimit: agreement.revisionLimit,
    role: (agreement.clientId === userId ? "CLIENT" : "FREELANCER") as "CLIENT" | "FREELANCER",
    milestones: agreement.milestones.map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      description: milestone.description,
      dueDate: milestone.dueDate,
      paymentAmount: Number(milestone.paymentAmount),
      status: milestone.status,
      paymentStatus: milestone.payment?.status ?? null,
    })),
  }));
}

/**
 * Requirement 13.7 — cron target: flags overdue milestones and notifies both
 * parties with the milestone name and due date.
 */
export async function checkOverdueMilestones(now: Date = new Date()): Promise<number> {
  const overdue = await prisma.milestone.findMany({
    where: {
      status: { in: ["PENDING", "DELIVERED"] },
      dueDate: { lt: now },
      overdueNotifiedAt: null,
    },
    include: { agreement: true },
  });

  let flagged = 0;
  for (const milestone of overdue) {
    await withTransaction(async (tx) => {
      await tx.milestone.update({
        where: { id: milestone.id },
        data: {
          status: milestone.status === "PENDING" ? "OVERDUE" : milestone.status,
          overdueNotifiedAt: now,
        },
      });
      await writeAuditLog(tx, {
        eventType: "MILESTONE_OVERDUE",
        actorId: milestone.agreement.clientId,
        resourceId: milestone.id,
        resourceType: "Milestone",
        previousState: milestone.status,
        newState: "OVERDUE",
        metadata: { dueDate: milestone.dueDate.toISOString() },
      });
      for (const userId of [milestone.agreement.clientId, milestone.agreement.freelancerId]) {
        await send(
          {
            userId,
            type: "MILESTONE_OVERDUE",
            payload: {
              milestoneId: milestone.id,
              milestoneName: milestone.name,
              dueDate: milestone.dueDate.toISOString(),
            },
          },
          tx,
        );
      }
    });
    flagged += 1;
  }
  return flagged;
}

export async function getMilestoneWithDeliverables(milestoneId: string, userId: string) {
  const milestone = await getMilestone(milestoneId);
  const context = await assertAgreementParticipant(milestone.agreementId, userId);
  const [deliverables, payment] = await Promise.all([
    prisma.deliverable.findMany({
      where: { milestoneId },
      orderBy: { versionNumber: "desc" },
    }),
    prisma.payment.findUnique({ where: { milestoneId } }),
  ]);
  return { milestone, deliverables, payment, ...context };
}
