import type { DiscoveryTermsType, Engagement, EngagementStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog, type TxClient } from "@/lib/audit";
import { ENGAGEMENT_TRANSITIONS, QUOTATION_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertBriefOwner, recordAccessViolation, type ProjectRole } from "@/lib/access";
import { send } from "@/lib/notifications";
import { nextVersionNumber } from "@/lib/agreements/invariants";
import { asRecordArray, asStringArray } from "@/lib/serializers";
import {
  approvalBlockers,
  normalizeContent,
  parseStoredContent,
  RequirementsContentSchema,
  type RequirementsContent,
} from "@/lib/requirements/content";
import { generateRequirementsDraft, type RequirementsGrounding } from "@/lib/ai/requirements";
import {
  agreedEndDate,
  buildSowDraft,
  unresolvedConflicts,
  SowSubmitSchema,
  type SowDraft,
  type SowSubmitInput,
} from "@/lib/engagements/sow";

/**
 * Engagement — the stage between choosing a freelancer and signing the SOW.
 *
 * Selecting a proposal is a selection decision, not a contract: it creates one
 * Engagement and no Agreement. The selected parties discuss, write and revise a
 * versioned requirements brief, and approve one exact version. Only then can
 * the SOW be generated, and submitting it creates the Agreement through the
 * same dual-approval flow as before.
 */

const ACCEPTABLE_QUOTATION_STATUSES = new Set(["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"]);
const OPEN_STATUSES: EngagementStatus[] = ["DISCOVERY", "REQUIREMENTS", "REQUIREMENTS_APPROVED"];

export interface EngagementContext {
  engagement: Engagement;
  role: ProjectRole;
  otherPartyId: string;
}

/** Only the selected Client and Freelancer may read or act on an Engagement. */
export async function assertEngagementParticipant(engagementId: string, userId: string): Promise<EngagementContext> {
  const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } });
  if (!engagement) throw new NotFoundError("Engagement");
  if (engagement.clientId === userId) {
    return { engagement, role: "CLIENT", otherPartyId: engagement.freelancerId };
  }
  if (engagement.freelancerId === userId) {
    return { engagement, role: "FREELANCER", otherPartyId: engagement.clientId };
  }
  await recordAccessViolation({
    actorId: userId,
    resourceId: engagementId,
    resourceType: "Engagement",
    reason: "NOT_ENGAGEMENT_PARTICIPANT",
  });
  throw new ForbiddenError("NOT_ENGAGEMENT_PARTICIPANT", "You are not a participant in this engagement.");
}

function assertOpen(engagement: Engagement, action: string): void {
  if (!OPEN_STATUSES.includes(engagement.status)) {
    throw new ConflictError(
      "ENGAGEMENT_NOT_OPEN",
      `This engagement no longer accepts ${action}.`,
      engagement.status,
    );
  }
}

async function moveStatus(
  tx: TxClient,
  engagement: Engagement,
  to: EngagementStatus,
  actorId: string,
  extra: Prisma.EngagementUpdateInput = {},
): Promise<Engagement> {
  if (engagement.status === to) {
    return tx.engagement.update({ where: { id: engagement.id }, data: extra });
  }
  assertTransition(
    ENGAGEMENT_TRANSITIONS,
    engagement.status,
    to,
    "ENGAGEMENT_TRANSITION_NOT_ALLOWED",
    `This engagement cannot move from ${engagement.status} to ${to}.`,
  );
  const updated = await tx.engagement.update({ where: { id: engagement.id }, data: { ...extra, status: to } });
  await writeAuditLog(tx, {
    eventType: "ENGAGEMENT_STATUS_CHANGED",
    actorId,
    resourceId: engagement.id,
    resourceType: "Engagement",
    previousState: engagement.status,
    newState: to,
  });
  return updated;
}

// ─── Selection ────────────────────────────────────────────────────────────────

/**
 * PRD FR-02 / AT-01 — the brief owner selects one proposal. Creates exactly one
 * Engagement; never an Agreement. Repeating the request returns the same
 * Engagement. A second proposal cannot be selected for the same brief while an
 * Engagement is open; cancelling it reopens the decision.
 */
export async function selectProposal(
  briefId: string,
  clientId: string,
  quotationId: string,
): Promise<{ engagement: Engagement; created: boolean }> {
  await assertBriefOwner(briefId, clientId);

  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation || quotation.briefId !== briefId) throw new NotFoundError("Quotation");

  const existing = await prisma.engagement.findUnique({ where: { quotationId } });
  if (existing) {
    if (existing.status === "CANCELLED") {
      throw new ConflictError(
        "ENGAGEMENT_CANCELLED",
        "The engagement for this proposal was cancelled. Select another proposal.",
        existing.status,
      );
    }
    return { engagement: existing, created: false };
  }

  if (!ACCEPTABLE_QUOTATION_STATUSES.has(quotation.status)) {
    throw new ConflictError("QUOTATION_NOT_ACCEPTABLE", "Only submitted proposals can be selected.", quotation.status);
  }

  const engagement = await withTransaction(async (tx) => {
    const awarded = await tx.engagement.findFirst({
      where: { briefId, status: { not: "CANCELLED" } },
    });
    if (awarded) {
      throw new ConflictError(
        "BRIEF_ALREADY_AWARDED",
        "Another proposal is already selected for this brief. Cancel that engagement to choose again.",
        awarded.status,
      );
    }

    assertTransition(
      QUOTATION_TRANSITIONS,
      quotation.status,
      "ACCEPTED",
      "QUOTATION_NOT_ACCEPTABLE",
      "Only submitted proposals can be selected.",
    );

    const created = await tx.engagement.create({
      data: {
        briefId,
        quotationId,
        clientId,
        freelancerId: quotation.freelancerId,
        status: "DISCOVERY",
      },
    });
    await tx.quotation.update({ where: { id: quotationId }, data: { status: "ACCEPTED" } });

    await writeAuditLog(tx, {
      eventType: "ENGAGEMENT_CREATED",
      actorId: clientId,
      resourceId: created.id,
      resourceType: "Engagement",
      previousState: null,
      newState: "DISCOVERY",
      metadata: { briefId, quotationId, previousQuotationStatus: quotation.status },
    });
    await send(
      {
        userId: quotation.freelancerId,
        type: "ENGAGEMENT_CREATED",
        payload: { engagementId: created.id, briefId },
      },
      tx,
    );
    return created;
  });

  return { engagement, created: true };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getEngagementDetail(engagementId: string, viewerId: string) {
  const context = await assertEngagementParticipant(engagementId, viewerId);
  const { engagement } = context;

  const [brief, quotation, people, messages, versions, comments, agreement] = await Promise.all([
    prisma.brief.findUniqueOrThrow({ where: { id: engagement.briefId } }),
    prisma.quotation.findUniqueOrThrow({ where: { id: engagement.quotationId } }),
    prisma.user.findMany({
      where: { id: { in: [engagement.clientId, engagement.freelancerId] } },
      select: { id: true, displayName: true },
    }),
    prisma.engagementMessage.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" } }),
    prisma.requirementsVersion.findMany({
      where: { engagementId },
      orderBy: { versionNumber: "asc" },
      include: { approvals: true },
    }),
    prisma.requirementsComment.findMany({ where: { engagementId }, orderBy: { createdAt: "asc" } }),
    engagement.agreementId
      ? prisma.agreement.findUnique({ where: { id: engagement.agreementId } })
      : Promise.resolve(null),
  ]);

  const nameById = new Map(people.map((person) => [person.id, person.displayName]));
  const roleOf = (userId: string): ProjectRole => (userId === engagement.clientId ? "CLIENT" : "FREELANCER");

  const parsedVersions = versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    authorRole: version.authorRole as ProjectRole,
    authorName: nameById.get(version.authorId) ?? "Unknown",
    draftEngine: version.draftEngine,
    changeSummary: version.changeSummary,
    createdAt: version.createdAt,
    approvedAt: version.approvedAt,
    content: parseStoredContent(version.content),
    clientApproved: version.approvals.some((approval) => approval.actorRole === "CLIENT"),
    freelancerApproved: version.approvals.some((approval) => approval.actorRole === "FREELANCER"),
  }));
  const current = parsedVersions.find((version) => version.versionNumber === engagement.currentRequirementsVersion) ?? null;

  return {
    engagement,
    role: context.role,
    brief: {
      id: brief.id,
      title: brief.title,
      description: brief.description,
      deliverables: asStringArray(brief.deliverables),
      budgetMin: Number(brief.budgetMin),
      budgetMax: Number(brief.budgetMax),
      targetDate: brief.targetDate,
    },
    proposal: {
      id: quotation.id,
      lineItems: proposalLineItems(quotation.lineItems),
      total: proposalLineItems(quotation.lineItems).reduce((sum, item) => sum + item.price, 0),
      timelineDays: quotation.timelineDays,
      notes: quotation.notes,
      submittedAt: quotation.submittedAt,
    },
    clientName: nameById.get(engagement.clientId) ?? "Unknown",
    freelancerName: nameById.get(engagement.freelancerId) ?? "Unknown",
    messages: messages.map((message) => ({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      authorRole: roleOf(message.authorId),
      authorName: nameById.get(message.authorId) ?? "Unknown",
    })),
    versions: parsedVersions,
    currentVersion: current,
    blockers: current ? approvalBlockers(current.content) : [],
    comments: comments.map((comment) => ({
      id: comment.id,
      versionNumber: parsedVersions.find((version) => version.id === comment.versionId)?.versionNumber ?? 0,
      requirementId: comment.requirementId,
      body: comment.body,
      status: comment.status,
      createdAt: comment.createdAt,
      resolvedAt: comment.resolvedAt,
      authorRole: roleOf(comment.authorId),
      authorName: nameById.get(comment.authorId) ?? "Unknown",
    })),
    agreement: agreement ? { id: agreement.id, status: agreement.status, currentVersion: agreement.currentVersion } : null,
  };
}

export type EngagementDetail = Awaited<ReturnType<typeof getEngagementDetail>>;

/** JSON-safe Engagement (Decimal fee as a number). */
export function toEngagementDto(engagement: Engagement) {
  return {
    ...engagement,
    discoveryFee: engagement.discoveryFee === null ? null : Number(engagement.discoveryFee),
  };
}

export async function listEngagementSummaries(userId: string) {
  const engagements = await prisma.engagement.findMany({
    where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
    orderBy: { createdAt: "desc" },
    include: {
      brief: { select: { title: true } },
      client: { select: { displayName: true } },
      freelancer: { select: { displayName: true } },
    },
  });
  return engagements.map((engagement) => ({
    id: engagement.id,
    status: engagement.status,
    title: engagement.brief.title,
    role: (engagement.clientId === userId ? "CLIENT" : "FREELANCER") as ProjectRole,
    counterpartName:
      engagement.clientId === userId ? engagement.freelancer.displayName : engagement.client.displayName,
    currentRequirementsVersion: engagement.currentRequirementsVersion,
    agreementId: engagement.agreementId,
    selectedAt: engagement.selectedAt,
  }));
}

/** The open Engagement for a brief, if one exists — used by brief and quotation pages. */
export async function findOpenEngagementForBrief(briefId: string) {
  return prisma.engagement.findFirst({ where: { briefId, status: { not: "CANCELLED" } } });
}

function proposalLineItems(value: unknown): Array<{ description: string; price: number }> {
  return asRecordArray(value).map((item) => ({
    description: typeof item.description === "string" ? item.description : "Untitled",
    price: typeof item.price === "number" ? item.price : Number(item.price ?? 0) || 0,
  }));
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export const MessageSchema = z.object({
  content: z.string().trim().min(1, "Message cannot be empty.").max(5000, "Message is at most 5000 characters."),
});

export async function postMessage(engagementId: string, actorId: string, content: string) {
  const context = await assertEngagementParticipant(engagementId, actorId);
  if (context.engagement.status === "CANCELLED") {
    throw new ConflictError("ENGAGEMENT_NOT_OPEN", "This engagement was cancelled.", "CANCELLED");
  }
  return withTransaction(async (tx) => {
    const message = await tx.engagementMessage.create({ data: { engagementId, authorId: actorId, content } });
    await writeAuditLog(tx, {
      eventType: "ENGAGEMENT_MESSAGE_POSTED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: null,
      newState: context.engagement.status,
      metadata: { messageId: message.id, actorRole: context.role },
    });
    await send(
      { userId: context.otherPartyId, type: "ENGAGEMENT_MESSAGE", payload: { engagementId, messageId: message.id } },
      tx,
    );
    return message;
  });
}

export const DiscoveryTermsSchema = z
  .object({
    discoveryType: z.enum(["UNPAID", "TIME_BOXED", "PAID"]),
    discoveryDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
    discoveryFee: z.coerce.number().min(0.01).max(999_999_999.99).optional().nullable(),
    discoveryNotes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.discoveryType === "TIME_BOXED" && !value.discoveryDays) {
      ctx.addIssue({ code: "custom", path: ["discoveryDays"], message: "Time-boxed discovery needs a number of days." });
    }
    if (value.discoveryType === "PAID" && !value.discoveryFee) {
      ctx.addIssue({ code: "custom", path: ["discoveryFee"], message: "Paid discovery needs a fee." });
    }
    if (value.discoveryType === "PAID" && !value.discoveryNotes) {
      ctx.addIssue({
        code: "custom",
        path: ["discoveryNotes"],
        message: "Paid discovery needs a description of the expected output.",
      });
    }
  });
export type DiscoveryTermsInput = z.infer<typeof DiscoveryTermsSchema>;

/**
 * PRD FR-03 — discovery is never silently assumed to be unlimited unpaid work.
 * The terms are recorded and audited; they describe the arrangement and do not
 * trigger a payment (paid discovery invoicing is out of scope for this stage).
 */
export async function updateDiscoveryTerms(engagementId: string, actorId: string, input: DiscoveryTermsInput) {
  const context = await assertEngagementParticipant(engagementId, actorId);
  const { engagement } = context;
  if (engagement.status !== "DISCOVERY" && engagement.status !== "REQUIREMENTS") {
    throw new ConflictError(
      "DISCOVERY_TERMS_LOCKED",
      "Discovery terms can only change before the requirements are approved.",
      engagement.status,
    );
  }
  const type = input.discoveryType as DiscoveryTermsType;
  return withTransaction(async (tx) => {
    const updated = await tx.engagement.update({
      where: { id: engagementId },
      data: {
        discoveryType: type,
        discoveryDays: type === "UNPAID" ? null : (input.discoveryDays ?? null),
        discoveryFee: type === "PAID" ? (input.discoveryFee ?? null) : null,
        discoveryNotes: input.discoveryNotes ?? null,
      },
    });
    await writeAuditLog(tx, {
      eventType: "ENGAGEMENT_TERMS_UPDATED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: engagement.discoveryType,
      newState: type,
      metadata: {
        actorRole: context.role,
        discoveryDays: updated.discoveryDays,
        discoveryFee: updated.discoveryFee === null ? null : Number(updated.discoveryFee),
      },
    });
    return updated;
  });
}

export const CancelSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for cancelling.").max(1000),
});

/** Cancelling keeps the accepted proposal, messages and versions; it only closes the engagement. */
export async function cancelEngagement(engagementId: string, actorId: string, reason: string) {
  const context = await assertEngagementParticipant(engagementId, actorId);
  assertOpen(context.engagement, "cancellation");
  return withTransaction(async (tx) => {
    const updated = await moveStatus(tx, context.engagement, "CANCELLED", actorId, {
      cancelledAt: new Date(),
      cancelReason: reason,
    });
    await writeAuditLog(tx, {
      eventType: "ENGAGEMENT_CANCELLED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: context.engagement.status,
      newState: "CANCELLED",
      metadata: { actorRole: context.role, reason },
    });
    await send(
      { userId: context.otherPartyId, type: "ENGAGEMENT_CANCELLED", payload: { engagementId, reason } },
      tx,
    );
    return updated;
  });
}

// ─── Requirements ─────────────────────────────────────────────────────────────

async function groundingFor(engagement: Engagement): Promise<RequirementsGrounding> {
  const [brief, quotation, messages] = await Promise.all([
    prisma.brief.findUniqueOrThrow({ where: { id: engagement.briefId } }),
    prisma.quotation.findUniqueOrThrow({ where: { id: engagement.quotationId } }),
    prisma.engagementMessage.findMany({ where: { engagementId: engagement.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const lineItems = proposalLineItems(quotation.lineItems);
  return {
    brief: {
      title: brief.title,
      description: brief.description,
      deliverables: asStringArray(brief.deliverables),
      budgetMin: Number(brief.budgetMin),
      budgetMax: Number(brief.budgetMax),
      targetDate: brief.targetDate,
    },
    proposal: {
      lineItems,
      total: lineItems.reduce((sum, item) => sum + item.price, 0),
      timelineDays: quotation.timelineDays,
      notes: quotation.notes,
    },
    messages: messages.map((message) => ({
      id: message.id,
      authorRole: message.authorId === engagement.clientId ? "CLIENT" : "FREELANCER",
      content: message.content,
    })),
    selectedAt: engagement.selectedAt,
  };
}

/** PRD FR-04 / AT-03 — returns a reviewable draft. Nothing is saved. */
export async function draftRequirements(engagementId: string, actorId: string) {
  const context = await assertEngagementParticipant(engagementId, actorId);
  assertOpen(context.engagement, "requirement drafts");
  const outcome = await generateRequirementsDraft(await groundingFor(context.engagement));
  if (!outcome.generated) {
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "AI_GENERATION_FAILED",
        actorId,
        resourceId: engagementId,
        resourceType: "Engagement",
        previousState: null,
        newState: "REQUIREMENTS_DRAFT_FAILED",
        metadata: { engine: outcome.engine },
      });
    });
  }
  return outcome;
}

export const SaveVersionSchema = z.object({
  /** The version the editor started from; guards against overwriting a newer save. */
  baseVersion: z.coerce.number().int().min(0),
  content: RequirementsContentSchema,
  changeSummary: z.string().trim().max(500).optional(),
  draftEngine: z.enum(["llm", "heuristic", "manual"]).default("manual"),
});
export type SaveVersionInput = z.input<typeof SaveVersionSchema>;

/**
 * PRD FR-04 / AT-04 — every save creates the next immutable version. The
 * previous current version becomes SUPERSEDED (its approvals stay on record but
 * never carry over). IDs and provenance are normalised server-side.
 */
export async function saveRequirementsVersion(engagementId: string, actorId: string, raw: SaveVersionInput) {
  const input = SaveVersionSchema.parse(raw);
  const context = await assertEngagementParticipant(engagementId, actorId);
  assertOpen(context.engagement, "requirement changes");

  return withTransaction(async (tx) => {
    const engagement = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    if (input.baseVersion !== engagement.currentRequirementsVersion) {
      throw new ConflictError(
        "STALE_REQUIREMENTS_VERSION",
        `Version ${engagement.currentRequirementsVersion} was saved while you were editing. Reload and apply your changes to it.`,
        String(engagement.currentRequirementsVersion),
      );
    }

    const history = await tx.requirementsVersion.findMany({
      where: { engagementId },
      orderBy: { versionNumber: "asc" },
    });
    const content = normalizeContent(
      input.content,
      context.role,
      history.map((version) => parseStoredContent(version.content)),
    );
    const versionNumber = nextVersionNumber(history.at(-1)?.versionNumber);

    const version = await tx.requirementsVersion.create({
      data: {
        engagementId,
        versionNumber,
        content: content as unknown as Prisma.InputJsonValue,
        authorId: actorId,
        authorRole: context.role,
        status: "IN_REVIEW",
        draftEngine: input.draftEngine,
        changeSummary: input.changeSummary || null,
      },
    });
    await tx.requirementsVersion.updateMany({
      where: { engagementId, versionNumber: { lt: versionNumber }, status: { not: "SUPERSEDED" } },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });

    await moveStatus(tx, engagement, "REQUIREMENTS", actorId, { currentRequirementsVersion: versionNumber });

    await writeAuditLog(tx, {
      eventType: "REQUIREMENTS_VERSION_CREATED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: history.length > 0 ? `VERSION_${history.at(-1)!.versionNumber}` : null,
      newState: `VERSION_${versionNumber}`,
      metadata: { versionId: version.id, versionNumber, authorRole: context.role, draftEngine: input.draftEngine },
    });
    await send(
      {
        userId: context.otherPartyId,
        type: "REQUIREMENTS_VERSION_CREATED",
        payload: { engagementId, versionNumber },
      },
      tx,
    );
    return version;
  });
}

export const ApproveSchema = z.object({
  versionNumber: z.coerce.number().int().min(1),
});

/**
 * PRD FR-05 / AT-05 / AT-06 — a party approves one exact version. The caller
 * names the version it is looking at, so a newer save can never be approved by
 * a click made on an older screen. Repeating the call is a no-op. Both
 * approvals on the current version freeze it as the baseline.
 */
export async function approveRequirements(engagementId: string, actorId: string, versionNumber: number) {
  const context = await assertEngagementParticipant(engagementId, actorId);
  const { engagement } = context;

  if (engagement.status !== "REQUIREMENTS" && engagement.status !== "REQUIREMENTS_APPROVED") {
    throw new ConflictError("REQUIREMENTS_NOT_IN_REVIEW", "There is no requirements version to approve.", engagement.status);
  }
  if (versionNumber !== engagement.currentRequirementsVersion) {
    throw new ConflictError(
      "NOT_CURRENT_REQUIREMENTS_VERSION",
      `Only the current version (${engagement.currentRequirementsVersion}) can be approved.`,
      String(engagement.currentRequirementsVersion),
    );
  }

  const version = await prisma.requirementsVersion.findUniqueOrThrow({
    where: { engagementId_versionNumber: { engagementId, versionNumber } },
  });
  const blockers = approvalBlockers(parseStoredContent(version.content));
  if (blockers.length > 0) {
    throw new ValidationError(
      blockers.map((blocker) => ({ field: blocker.itemId ?? "content", message: blocker.message })),
      "This version cannot be approved yet. Save a revision that resolves the listed items.",
    );
  }

  return withTransaction(async (tx) => {
    const already = await tx.requirementsApproval.findUnique({
      where: { versionId_actorRole: { versionId: version.id, actorRole: context.role } },
    });
    if (!already) {
      await tx.requirementsApproval.create({
        data: {
          engagementId,
          versionId: version.id,
          versionNumber,
          actorId,
          actorRole: context.role,
        },
      });
      await writeAuditLog(tx, {
        eventType: "REQUIREMENTS_APPROVED",
        actorId,
        resourceId: engagementId,
        resourceType: "Engagement",
        previousState: version.status,
        newState: version.status,
        metadata: { versionId: version.id, versionNumber, actorRole: context.role },
      });
    }

    const approvals = await tx.requirementsApproval.findMany({ where: { versionId: version.id } });
    const both =
      approvals.some((approval) => approval.actorRole === "CLIENT") &&
      approvals.some((approval) => approval.actorRole === "FREELANCER");

    const current = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    if (!both || current.status === "REQUIREMENTS_APPROVED") {
      return { engagement: current, baselineApproved: both };
    }

    await tx.requirementsVersion.update({
      where: { id: version.id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    const updated = await moveStatus(tx, current, "REQUIREMENTS_APPROVED", actorId);
    await writeAuditLog(tx, {
      eventType: "REQUIREMENTS_BASELINE_APPROVED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: "IN_REVIEW",
      newState: "APPROVED",
      metadata: { versionId: version.id, versionNumber },
    });
    for (const userId of [engagement.clientId, engagement.freelancerId]) {
      await send({ userId, type: "REQUIREMENTS_APPROVED", payload: { engagementId, versionNumber } }, tx);
    }
    return { engagement: updated, baselineApproved: true };
  });
}

export const CommentSchema = z.object({
  versionNumber: z.coerce.number().int().min(1),
  requirementId: z.string().trim().max(20).optional().nullable(),
  body: z.string().trim().min(1, "Comment cannot be empty.").max(2000),
});

/** Comments anchor to one version and, optionally, one requirement ID in it. */
export async function addRequirementsComment(
  engagementId: string,
  actorId: string,
  input: z.infer<typeof CommentSchema>,
) {
  const context = await assertEngagementParticipant(engagementId, actorId);
  if (context.engagement.status === "CANCELLED") {
    throw new ConflictError("ENGAGEMENT_NOT_OPEN", "This engagement was cancelled.", "CANCELLED");
  }
  const version = await prisma.requirementsVersion.findUnique({
    where: { engagementId_versionNumber: { engagementId, versionNumber: input.versionNumber } },
  });
  if (!version) throw new NotFoundError("Requirements version");
  const requirementId = input.requirementId || null;
  if (requirementId) {
    const content = parseStoredContent(version.content);
    const ids = [...content.functional, ...content.nonFunctional, ...content.assumptions].map((item) => item.id);
    if (!ids.includes(requirementId)) {
      throw new ValidationError([{ field: "requirementId", message: `${requirementId} is not in version ${version.versionNumber}.` }]);
    }
  }
  return withTransaction(async (tx) => {
    const comment = await tx.requirementsComment.create({
      data: { engagementId, versionId: version.id, requirementId, authorId: actorId, body: input.body },
    });
    await writeAuditLog(tx, {
      eventType: "REQUIREMENTS_COMMENT_POSTED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: null,
      newState: "OPEN",
      metadata: { commentId: comment.id, versionNumber: version.versionNumber, requirementId },
    });
    await send(
      {
        userId: context.otherPartyId,
        type: "REQUIREMENTS_COMMENT",
        payload: { engagementId, versionNumber: version.versionNumber, requirementId },
      },
      tx,
    );
    return comment;
  });
}

/** Resolving is explicit and recorded; the comment itself is never erased. */
export async function resolveRequirementsComment(engagementId: string, commentId: string, actorId: string) {
  await assertEngagementParticipant(engagementId, actorId);
  const comment = await prisma.requirementsComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.engagementId !== engagementId) throw new NotFoundError("Comment");
  if (comment.status === "RESOLVED") return comment;
  return withTransaction(async (tx) => {
    const updated = await tx.requirementsComment.update({
      where: { id: commentId },
      data: { status: "RESOLVED", resolvedById: actorId, resolvedAt: new Date() },
    });
    await writeAuditLog(tx, {
      eventType: "REQUIREMENTS_COMMENT_RESOLVED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: "OPEN",
      newState: "RESOLVED",
      metadata: { commentId },
    });
    return updated;
  });
}

// ─── SOW ──────────────────────────────────────────────────────────────────────

async function approvedBaseline(client: Prisma.TransactionClient, engagement: Engagement) {
  const version = await client.requirementsVersion.findUnique({
    where: {
      engagementId_versionNumber: { engagementId: engagement.id, versionNumber: engagement.currentRequirementsVersion },
    },
    include: { approvals: true },
  });
  const roles = new Set(version?.approvals.map((approval) => approval.actorRole) ?? []);
  if (!version || version.status !== "APPROVED" || !roles.has("CLIENT") || !roles.has("FREELANCER")) {
    throw new ConflictError(
      "REQUIREMENTS_NOT_APPROVED",
      "Both parties must approve the current requirements version before the SOW can be generated.",
      engagement.status,
    );
  }
  return { version, content: parseStoredContent(version.content) as RequirementsContent };
}

async function buildDraftFor(client: Prisma.TransactionClient, engagement: Engagement, startDate: Date): Promise<SowDraft> {
  const { version, content } = await approvedBaseline(client, engagement);
  const [brief, quotation] = await Promise.all([
    client.brief.findUniqueOrThrow({ where: { id: engagement.briefId } }),
    client.quotation.findUniqueOrThrow({ where: { id: engagement.quotationId } }),
  ]);
  return buildSowDraft({
    engagementId: engagement.id,
    quotationId: quotation.id,
    briefId: brief.id,
    briefTitle: brief.title,
    briefTargetDate: brief.targetDate,
    budgetMin: Number(brief.budgetMin),
    budgetMax: Number(brief.budgetMax),
    lineItems: proposalLineItems(quotation.lineItems),
    timelineDays: quotation.timelineDays,
    proposalNotes: quotation.notes,
    currency: "USD",
    requirementsVersionId: version.id,
    requirementsVersionNumber: version.versionNumber,
    requirements: content,
    startDate,
  });
}

/** PRD FR-06 — the SOW preview, available only once the baseline is approved. */
export async function getSowPreview(engagementId: string, viewerId: string) {
  const context = await assertEngagementParticipant(engagementId, viewerId);
  if (context.engagement.status !== "REQUIREMENTS_APPROVED") {
    throw new ConflictError(
      "REQUIREMENTS_NOT_APPROVED",
      "The SOW is available once both parties approve the same requirements version.",
      context.engagement.status,
    );
  }
  return { context, draft: await buildDraftFor(prisma, context.engagement, new Date()) };
}

/**
 * PRD FR-06 / AT-07 / AT-08 — rebuilds the SOW from the approved baseline,
 * refuses while any conflict is unresolved, and creates the Agreement at
 * version 1 with both approvals PENDING. The existing dual-approval flow takes
 * it from there. Submitting twice returns the Agreement already created.
 */
export async function submitSow(engagementId: string, actorId: string, raw: SowSubmitInput) {
  const input = SowSubmitSchema.parse(raw);
  const context = await assertEngagementParticipant(engagementId, actorId);
  if (context.engagement.status === "AGREEMENT" && context.engagement.agreementId) {
    return { agreementId: context.engagement.agreementId, created: false };
  }
  if (context.engagement.status !== "REQUIREMENTS_APPROVED") {
    throw new ConflictError(
      "REQUIREMENTS_NOT_APPROVED",
      "The SOW can be submitted only after both parties approve the requirements.",
      context.engagement.status,
    );
  }

  return withTransaction(async (tx) => {
    const engagement = await tx.engagement.findUniqueOrThrow({ where: { id: engagementId } });
    if (engagement.agreementId) return { agreementId: engagement.agreementId, created: false };

    const startDate = new Date();
    const draft = await buildDraftFor(tx, engagement, startDate);
    const missing = unresolvedConflicts(draft, input.resolutions);
    if (missing.length > 0) {
      throw new ValidationError(
        missing.map((message) => ({ field: "resolutions", message })),
        "Resolve every conflict between the proposal and the requirements before submitting.",
      );
    }

    const resolutions = Object.fromEntries(
      draft.conflicts.map((conflict) => [conflict.id, input.resolutions[conflict.id]]),
    );
    const snapshot = {
      // Fields the agreement page, scope classifier and collaboration history
      // already read from every agreement snapshot.
      quotationId: draft.quotationId,
      briefId: draft.briefId,
      title: draft.title,
      description: draft.objective,
      deliverables: draft.deliverables.map((deliverable) => deliverable.title),
      budgetMin: draft.budgetMin,
      budgetMax: draft.budgetMax,
      lineItems: draft.lineItems,
      total: draft.total,
      timelineDays: draft.timelineDays,
      notes: draft.proposalNotes,
      currency: draft.currency,
      capturedAt: startDate.toISOString(),
      // The SOW itself.
      sow: {
        ...draft,
        revisionLimit: input.revisionLimit,
        agreedEndDate: agreedEndDate(draft, resolutions),
        conflictResolutions: resolutions,
        submittedByRole: context.role,
      },
    };

    const agreement = await tx.agreement.create({
      data: {
        briefId: engagement.briefId,
        quotationId: engagement.quotationId,
        clientId: engagement.clientId,
        freelancerId: engagement.freelancerId,
        status: "PENDING_APPROVAL",
        currentVersion: 1,
        revisionLimit: input.revisionLimit,
        currency: draft.currency,
        startDate,
      },
    });
    const version = await tx.agreementVersion.create({
      data: {
        agreementId: agreement.id,
        versionNumber: 1,
        content: snapshot as unknown as Prisma.InputJsonValue,
        authorId: actorId,
        authorRole: "PLATFORM",
        requirementsVersionId: draft.requirementsVersionId,
      },
    });
    for (const [userId, actorRole] of [
      [engagement.clientId, "CLIENT"],
      [engagement.freelancerId, "FREELANCER"],
    ] as const) {
      await tx.agreementApproval.create({
        data: { agreementId: agreement.id, versionId: version.id, versionNumber: 1, actorId: userId, actorRole, state: "PENDING" },
      });
    }

    await moveStatus(tx, engagement, "AGREEMENT", actorId, { agreement: { connect: { id: agreement.id } } });

    await writeAuditLog(tx, {
      eventType: "SOW_SUBMITTED",
      actorId,
      resourceId: engagementId,
      resourceType: "Engagement",
      previousState: "REQUIREMENTS_APPROVED",
      newState: "AGREEMENT",
      metadata: {
        agreementId: agreement.id,
        requirementsVersionId: draft.requirementsVersionId,
        requirementsVersionNumber: draft.requirementsVersionNumber,
        quotationId: draft.quotationId,
        resolutions,
        revisionLimit: input.revisionLimit,
      },
    });
    await writeAuditLog(tx, {
      eventType: "AGREEMENT_CREATED",
      actorId,
      resourceId: agreement.id,
      resourceType: "Agreement",
      previousState: null,
      newState: "PENDING_APPROVAL",
      metadata: { engagementId, quotationId: draft.quotationId, requirementsVersionId: draft.requirementsVersionId },
    });
    await writeAuditLog(tx, {
      eventType: "AGREEMENT_VERSION_CREATED",
      actorId,
      resourceId: agreement.id,
      resourceType: "Agreement",
      previousState: null,
      newState: "VERSION_1",
      metadata: { versionNumber: 1, authorRole: "PLATFORM", source: "SOW" },
    });
    for (const userId of [engagement.clientId, engagement.freelancerId]) {
      await send(
        { userId, type: "AGREEMENT_READY", payload: { agreementId: agreement.id, engagementId, versionNumber: 1 } },
        tx,
      );
    }
    return { agreementId: agreement.id, created: true };
  });
}
