import type { Agreement, AgreementVersion, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog, type TxClient } from "@/lib/audit";
import { AGREEMENT_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";
import { nextVersionNumber, isDualApproved, approvalSummary } from "@/lib/agreements/invariants";
import { quotationTotal } from "@/lib/quotations";
import { asStringArray } from "@/lib/serializers";
import { completeProject } from "@/lib/collaboration";

export interface AgreementSnapshot {
  quotationId: string;
  briefId: string;
  title: string;
  description: string;
  deliverables: string[];
  budgetMin: number;
  budgetMax: number;
  lineItems: unknown;
  total: number;
  timelineDays: number;
  notes: string;
  currency: string;
  capturedAt: string;
}

export async function buildSnapshotFromQuotation(
  tx: TxClient,
  quotationId: string,
  currency = "USD",
): Promise<AgreementSnapshot> {
  const quotation = await tx.quotation.findUnique({
    where: { id: quotationId },
    include: { brief: true },
  });
  if (!quotation) throw new NotFoundError("Quotation");
  return {
    quotationId,
    briefId: quotation.briefId,
    title: quotation.brief.title,
    description: quotation.brief.description,
    deliverables: asStringArray(quotation.brief.deliverables),
    budgetMin: Number(quotation.brief.budgetMin),
    budgetMax: Number(quotation.brief.budgetMax),
    lineItems: quotation.lineItems,
    total: quotationTotal(quotation.lineItems),
    timelineDays: quotation.timelineDays,
    notes: quotation.notes,
    currency,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Requirement 9.1/9.2 — accepting a Quotation creates the Agreement plus an
 * immutable Agreement Version 1 snapshot authored by the Platform on behalf of
 * the accepting Client.
 */
export async function createAgreementFromQuotation(
  quotationId: string,
  clientId: string,
): Promise<Agreement> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { brief: true },
  });
  if (!quotation) throw new NotFoundError("Quotation");

  if (quotation.brief.clientId !== clientId) {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: quotationId,
      resourceType: "Quotation",
      reason: "NOT_BRIEF_OWNER",
    });
    throw new ForbiddenError("NOT_BRIEF_OWNER", "Only the owning Client may accept this quotation.");
  }
  if (quotation.status !== "SUBMITTED" && quotation.status !== "SHORTLISTED" && quotation.status !== "UNDER_REVIEW") {
    throw new ConflictError(
      "QUOTATION_NOT_ACCEPTABLE",
      "Only submitted quotations can be accepted.",
      quotation.status,
    );
  }

  const existing = await prisma.agreement.findFirst({ where: { quotationId } });
  if (existing) {
    throw new ConflictError("AGREEMENT_EXISTS", "An agreement already exists for this quotation.", existing.status);
  }

  return withTransaction(async (tx) => {
    const agreement = await tx.agreement.create({
      data: {
        briefId: quotation.briefId,
        quotationId,
        clientId,
        freelancerId: quotation.freelancerId,
        status: "PENDING_APPROVAL",
        currentVersion: 1,
        currency: "USD",
        startDate: new Date(),
      },
    });

    const snapshot = await buildSnapshotFromQuotation(tx, quotationId, "USD");
    const version = await tx.agreementVersion.create({
      data: {
        agreementId: agreement.id,
        versionNumber: 1,
        content: snapshot as unknown as Prisma.InputJsonValue,
        authorId: clientId,
        authorRole: "PLATFORM",
      },
    });

    // Both parties start PENDING for version 1.
    for (const [actorId, actorRole] of [
      [agreement.clientId, "CLIENT"],
      [agreement.freelancerId, "FREELANCER"],
    ] as const) {
      await tx.agreementApproval.create({
        data: {
          agreementId: agreement.id,
          versionId: version.id,
          versionNumber: 1,
          actorId,
          actorRole,
          state: "PENDING",
        },
      });
    }

    await tx.quotation.update({ where: { id: quotationId }, data: { status: "ACCEPTED" } });

    await writeAuditLog(tx, {
      eventType: "AGREEMENT_CREATED",
      actorId: clientId,
      resourceId: agreement.id,
      resourceType: "Agreement",
      previousState: null,
      newState: "PENDING_APPROVAL",
      metadata: { quotationId, versionNumber: 1 },
    });
    await writeAuditLog(tx, {
      eventType: "AGREEMENT_VERSION_CREATED",
      actorId: clientId,
      resourceId: agreement.id,
      resourceType: "Agreement",
      previousState: null,
      newState: "VERSION_1",
      metadata: { versionNumber: 1, authorRole: "PLATFORM" },
    });

    await send(
      {
        userId: agreement.freelancerId,
        type: "AGREEMENT_READY",
        payload: { agreementId: agreement.id, briefId: agreement.briefId, versionNumber: 1 },
      },
      tx,
    );

    return agreement;
  });
}

/**
 * Requirements 9.3/9.4 — both parties must approve the SAME version before the
 * Agreement becomes ACTIVE. The role is derived server-side; clients cannot
 * claim a role.
 */
export async function approveVersion(agreementId: string, actorId: string): Promise<Agreement> {
  const context = await assertAgreementParticipant(agreementId, actorId);
  const agreement = context.agreement;

  if (agreement.status === "COMPLETED" || agreement.status === "CANCELLED") {
    throw new ConflictError("AGREEMENT_CLOSED", "This agreement is no longer open.", agreement.status);
  }

  return withTransaction(async (tx) => {
    const current = await tx.agreementVersion.findUnique({
      where: {
        agreementId_versionNumber: {
          agreementId,
          versionNumber: agreement.currentVersion,
        },
      },
    });
    if (!current) throw new NotFoundError("Agreement version");

    await tx.agreementApproval.upsert({
      where: {
        agreementId_versionNumber_actorRole: {
          agreementId,
          versionNumber: agreement.currentVersion,
          actorRole: context.role,
        },
      },
      create: {
        agreementId,
        versionId: current.id,
        versionNumber: agreement.currentVersion,
        actorId,
        actorRole: context.role,
        state: "APPROVED",
        approvedAt: new Date(),
      },
      update: {
        state: "APPROVED",
        approvedAt: new Date(),
        retractedAt: null,
        actorId,
      },
    });

    await writeAuditLog(tx, {
      eventType: "AGREEMENT_APPROVED",
      actorId,
      resourceId: agreementId,
      resourceType: "Agreement",
      previousState: agreement.status,
      newState: agreement.status,
      metadata: { versionNumber: agreement.currentVersion, actorRole: context.role },
    });

    const approvals = await tx.agreementApproval.findMany({ where: { agreementId } });
    if (!isDualApproved(approvals, agreement.currentVersion)) {
      const updated = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
      return updated;
    }

    assertTransition(
      AGREEMENT_TRANSITIONS,
      agreement.status,
      "ACTIVE",
      "AGREEMENT_NOT_ACTIVATABLE",
      "This agreement cannot be activated from its current status.",
    );

    const active = await tx.agreement.update({
      where: { id: agreementId },
      data: { status: "ACTIVE", startDate: agreement.startDate ?? new Date() },
    });

    await writeAuditLog(tx, {
      eventType: "AGREEMENT_ACTIVATED",
      actorId,
      resourceId: agreementId,
      resourceType: "Agreement",
      previousState: agreement.status,
      newState: "ACTIVE",
      metadata: { versionNumber: agreement.currentVersion },
    });

    for (const userId of [agreement.clientId, agreement.freelancerId]) {
      await send(
        {
          userId,
          type: "AGREEMENT_ACTIVE",
          payload: { agreementId, versionNumber: agreement.currentVersion },
        },
        tx,
      );
    }

    return active;
  });
}

/**
 * Requirements 9.5/9.6/9.7 — creates the next immutable version, authored by the
 * requesting party, and resets both approval states to PENDING.
 *
 * `client` lets a caller that already holds a transaction (for example the
 * change-request vote handler) create the version atomically with its own
 * writes; the unique constraint on `(agreementId, versionNumber)` still guards
 * the monotonicity invariant at the database level.
 */
export async function createNewVersion(
  agreementId: string,
  actorId: string,
  changes: Record<string, unknown>,
  client?: TxClient,
): Promise<AgreementVersion> {
  const context = await assertAgreementParticipant(agreementId, actorId);
  if (context.agreement.status === "COMPLETED" || context.agreement.status === "CANCELLED") {
    throw new ConflictError("AGREEMENT_CLOSED", "This agreement is no longer open.", context.agreement.status);
  }

  return withTransaction(async (tx) => {
    const max = await tx.agreementVersion.aggregate({
      where: { agreementId },
      _max: { versionNumber: true },
    });
    const nextNumber = nextVersionNumber(max._max.versionNumber);

    const latest = await tx.agreementVersion.findFirst({
      where: { agreementId },
      orderBy: { versionNumber: "desc" },
    });
    if (!latest) throw new NotFoundError("Agreement version");

    const merged = {
      ...(latest.content as Record<string, unknown>),
      ...changes,
      capturedAt: new Date().toISOString(),
      amendedBy: context.role,
    };

    const version = await tx.agreementVersion.create({
      data: {
        agreementId,
        versionNumber: nextNumber,
        content: merged as unknown as Prisma.InputJsonValue,
        authorId: actorId,
        authorRole: context.role,
      },
    });

    // Reset both approval states for the new version.
    for (const [userId, actorRole] of [
      [context.agreement.clientId, "CLIENT"],
      [context.agreement.freelancerId, "FREELANCER"],
    ] as const) {
      await tx.agreementApproval.upsert({
        where: {
          agreementId_versionNumber_actorRole: {
            agreementId,
            versionNumber: nextNumber,
            actorRole,
          },
        },
        create: {
          agreementId,
          versionId: version.id,
          versionNumber: nextNumber,
          actorId: userId,
          actorRole,
          state: "PENDING",
        },
        update: { state: "PENDING", approvedAt: null, versionId: version.id },
      });
    }

    await tx.agreement.update({
      where: { id: agreementId },
      data: { currentVersion: nextNumber, status: "PENDING_APPROVAL" },
    });

    await writeAuditLog(tx, {
      eventType: "AGREEMENT_VERSION_CREATED",
      actorId,
      resourceId: agreementId,
      resourceType: "Agreement",
      previousState: latest.versionNumber.toString(),
      newState: `VERSION_${nextNumber}`,
      metadata: { versionNumber: nextNumber, authorRole: context.role },
    });

    for (const userId of [context.agreement.clientId, context.agreement.freelancerId]) {
      await send(
        {
          userId,
          type: "AGREEMENT_READY",
          payload: { agreementId, versionNumber: nextNumber },
        },
        tx,
      );
    }

    return version;
  }, client);
}

/** Requirement 9.7 — historical versions in ascending order, read-only. */
export async function getVersionHistory(agreementId: string): Promise<AgreementVersion[]> {
  return prisma.agreementVersion.findMany({
    where: { agreementId },
    orderBy: { versionNumber: "asc" },
  });
}

export async function getAgreementDetail(agreementId: string, viewerId: string) {
  const context = await assertAgreementParticipant(agreementId, viewerId);
  const [versions, approvals, milestones] = await Promise.all([
    getVersionHistory(agreementId),
    prisma.agreementApproval.findMany({ where: { agreementId }, orderBy: { versionNumber: "asc" } }),
    prisma.milestone.findMany({ where: { agreementId }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] }),
  ]);
  const current = versions.find((version) => version.versionNumber === context.agreement.currentVersion) ?? null;
  return {
    agreement: context.agreement,
    role: context.role,
    versions,
    approvals,
    milestones,
    currentVersion: current,
    approvalState: approvalSummary(approvals, context.agreement.currentVersion),
  };
}

export async function listAgreementsForUser(userId: string) {
  return prisma.agreement.findMany({
    where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Dashboard listing: the agreements a user takes part in, with the counterpart's
 * display name and milestone progress so the list is readable without a second
 * round trip per row.
 */
export async function listAgreementSummaries(userId: string) {
  const agreements = await prisma.agreement.findMany({
    where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
    orderBy: { createdAt: "desc" },
    include: {
      milestones: { select: { id: true, status: true, paymentAmount: true } },
      brief: { select: { id: true, title: true } },
    },
  });
  if (agreements.length === 0) return [];

  const counterpartIds = [...new Set(agreements.map((a) => (a.clientId === userId ? a.freelancerId : a.clientId)))];
  const people = await prisma.user.findMany({
    where: { id: { in: counterpartIds } },
    select: { id: true, displayName: true },
  });
  const nameById = new Map(people.map((person) => [person.id, person.displayName]));

  return agreements.map((agreement) => ({
    ...agreement,
    role: (agreement.clientId === userId ? "CLIENT" : "FREELANCER") as "CLIENT" | "FREELANCER",
    counterpartId: agreement.clientId === userId ? agreement.freelancerId : agreement.clientId,
    counterpartName:
      nameById.get(agreement.clientId === userId ? agreement.freelancerId : agreement.clientId) ?? "Unknown",
    milestoneCount: agreement.milestones.length,
    approvedMilestones: agreement.milestones.filter((milestone) => milestone.status === "APPROVED").length,
  }));
}

/**
 * Marks an Agreement COMPLETED once every milestone is APPROVED and every
 * payment is CAPTURED (Requirement 20.1 trigger).
 */
export async function maybeCompleteAgreement(agreementId: string): Promise<boolean> {
  const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
  if (!agreement || agreement.status === "COMPLETED") return false;

  const milestones = await prisma.milestone.findMany({
    where: { agreementId },
    include: { payment: true },
  });
  if (milestones.length === 0) return false;

  const allApproved = milestones.every((milestone) => milestone.status === "APPROVED");
  const allPaid = milestones.every((milestone) => milestone.payment?.status === "CAPTURED");
  if (!allApproved || !allPaid) return false;

  await withTransaction(async (tx) => {
    const current = await tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
    assertTransition(
      AGREEMENT_TRANSITIONS,
      current.status,
      "COMPLETED",
      "AGREEMENT_NOT_COMPLETABLE",
      "This agreement cannot be completed.",
    );
    await tx.agreement.update({
      where: { id: agreementId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    const latestVersion = await tx.agreementVersion.findFirst({
      where: { agreementId },
      orderBy: { versionNumber: "desc" },
    });
    await writeAuditLog(tx, {
      eventType: "AGREEMENT_COMPLETED",
      actorId: current.clientId,
      resourceId: agreementId,
      resourceType: "Agreement",
      previousState: current.status,
      newState: "COMPLETED",
      metadata: { versionNumber: latestVersion?.versionNumber ?? current.currentVersion },
    });
  });

  // Requirement 20.1 — a completed project is appended to the pair's history.
  await completeProject(agreementId);

  return true;
}

export async function getAgreement(agreementId: string): Promise<Agreement> {
  const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
  if (!agreement) throw new NotFoundError("Agreement");
  return agreement;
}

export async function assertAgreementActive(agreementId: string): Promise<Agreement> {
  const agreement = await getAgreement(agreementId);
  if (agreement.status !== "ACTIVE") {
    throw new ConflictError(
      "AGREEMENT_NOT_ACTIVE",
      "This action requires an active agreement.",
      agreement.status,
    );
  }
  return agreement;
}

export async function validateRevisionLimit(limit: number): Promise<number> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new ValidationError([
      { field: "revisionLimit", message: "Revision limit must be between 1 and 10." },
    ]);
  }
  return limit;
}
