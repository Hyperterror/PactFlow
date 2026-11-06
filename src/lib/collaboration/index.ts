import { z } from "zod";
import type { CollaborationHistory, CollaborationSummary, WorkingPreference } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";
import { asRecordArray, asStringArray } from "@/lib/serializers";
import { generateCollaborationSummary as runAISummary, addFlag, INSUFFICIENT_HISTORY_NOTICE } from "@/lib/ai/collaboration";
import type { CollaborationSummary as SummaryContent } from "@/lib/ai/schemas";
import { SendInvitationSchema, sendInvitation } from "@/lib/invitations";

/**
 * Requirement 20/21/22 — Relationship Intelligence.
 *
 * Collaboration_History rows are append-only: this module exposes no update or
 * delete path for them (property 10). Preferences are the only mutable part and
 * a CONFIRMED preference can only change through an explicit re-submission that
 * returns it to PENDING_ACKNOWLEDGEMENT.
 */

export const SUMMARY_CACHE_HOURS = 24;
export const PREFERENCE_MIN_LENGTH = 5;
export const PREFERENCE_MAX_LENGTH = 500;

export const PreferenceSchema = z.object({
  statement: z
    .string()
    .trim()
    .min(PREFERENCE_MIN_LENGTH, `Preference must be at least ${PREFERENCE_MIN_LENGTH} characters.`)
    .max(PREFERENCE_MAX_LENGTH, `Preference must be at most ${PREFERENCE_MAX_LENGTH} characters.`),
});

export const TemplateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(200),
});

export const RepeatInvitationSchema = SendInvitationSchema;

export type PreferenceInput = z.infer<typeof PreferenceSchema>;

function pairRole(history: { clientId: string; freelancerId: string }, userId: string) {
  if (history.clientId === userId) return "CLIENT" as const;
  if (history.freelancerId === userId) return "FREELANCER" as const;
  return null;
}

async function loadHistoryForParticipant(historyId: string, userId: string) {
  const history = await prisma.collaborationHistory.findUnique({ where: { id: historyId } });
  if (!history) throw new NotFoundError("CollaborationHistory");
  const role = pairRole(history, userId);
  if (!role) {
    await recordAccessViolation({
      actorId: userId,
      resourceId: historyId,
      resourceType: "CollaborationHistory",
      reason: "NOT_COLLABORATION_PARTICIPANT",
    });
    throw new ForbiddenError("NOT_COLLABORATION_PARTICIPANT", "Only the Client and Freelancer on this history may view it.");
  }
  return { history, role, otherPartyId: role === "CLIENT" ? history.freelancerId : history.clientId };
}

/** Requirement 20.1 — all milestones approved and all payments captured. */
export async function isProjectComplete(agreementId: string): Promise<boolean> {
  const milestones = await prisma.milestone.findMany({
    where: { agreementId },
    select: { id: true, status: true, payment: { select: { status: true } } },
  });
  if (milestones.length === 0) return false;
  return milestones.every(
    (milestone) => milestone.status === "APPROVED" && milestone.payment?.status === "CAPTURED",
  );
}

/**
 * Requirement 20.1/20.2 — appends the completed project to the pair's history.
 * Idempotent: a second call returns the existing entry and never rewrites it.
 */
export async function completeProject(agreementId: string): Promise<CollaborationHistory> {
  const existing = await prisma.collaborationHistory.findUnique({ where: { agreementId } });
  if (existing) return existing;

  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    include: {
      brief: true,
      versions: { orderBy: { versionNumber: "desc" } },
      milestones: { include: { deliverables: true, payment: true } },
    },
  });
  if (!agreement) throw new NotFoundError("Agreement");

  const completedAt = agreement.completedAt ?? new Date();
  const currentVersion =
    agreement.versions.find((version) => version.versionNumber === agreement.currentVersion) ??
    agreement.versions[0] ??
    null;

  const approvedDeliverables = agreement.milestones
    .flatMap((milestone) =>
      milestone.deliverables
        .filter((deliverable) => deliverable.status === "APPROVED")
        .map((deliverable) => ({
          id: deliverable.id,
          milestoneId: milestone.id,
          milestoneName: milestone.name,
          fileName: deliverable.fileName,
          versionNumber: deliverable.versionNumber,
          uploadedAt: deliverable.uploadedAt.toISOString(),
        })),
    )
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));

  const capturedTotal = agreement.milestones.reduce((sum, milestone) => {
    if (milestone.payment?.status === "CAPTURED" && milestone.payment.amountCaptured !== null) {
      return sum + Number(milestone.payment.amountCaptured);
    }
    return sum;
  }, 0);

  const agreementSnapshot = {
    agreementId: agreement.id,
    briefId: agreement.briefId,
    briefTitle: agreement.brief.title,
    quotationId: agreement.quotationId,
    versionNumber: currentVersion?.versionNumber ?? agreement.currentVersion,
    content: currentVersion?.content ?? null,
    startDate: agreement.startDate ? agreement.startDate.toISOString() : null,
    completedAt: completedAt.toISOString(),
    milestoneCount: agreement.milestones.length,
    currency: agreement.currency,
  };

  return withTransaction(async (tx) => {
    const created = await tx.collaborationHistory.create({
      data: {
        clientId: agreement.clientId,
        freelancerId: agreement.freelancerId,
        agreementId,
        agreementSnapshot: agreementSnapshot as object,
        deliverables: approvedDeliverables as object,
        completedAt,
        totalPaymentAmount: capturedTotal,
      },
    });

    await writeAuditLog(tx, {
      eventType: "COLLABORATION_HISTORY_CREATED",
      actorId: agreement.clientId,
      resourceId: created.id,
      resourceType: "CollaborationHistory",
      previousState: null,
      newState: "COMPLETED",
      metadata: { agreementId, totalPaymentAmount: capturedTotal },
    });

    for (const userId of [agreement.clientId, agreement.freelancerId]) {
      await send(
        {
          userId,
          type: "COLLABORATION_READY",
          payload: { historyId: created.id, agreementId, briefTitle: agreement.brief.title },
        },
        tx,
      );
    }

    return created;
  });
}

/**
 * Requirement 20.4 — a new statement starts at PENDING_ACKNOWLEDGEMENT and only
 * the other party can confirm it.
 */
export async function addWorkingPreference(
  historyId: string,
  authorId: string,
  input: PreferenceInput,
): Promise<WorkingPreference> {
  const { otherPartyId } = await loadHistoryForParticipant(historyId, authorId);

  return withTransaction(async (tx) => {
    const preference = await tx.workingPreference.create({
      data: {
        historyId,
        authorId,
        statement: input.statement,
        status: "PENDING_ACKNOWLEDGEMENT",
      },
    });

    await writeAuditLog(tx, {
      eventType: "PREFERENCE_ADDED",
      actorId: authorId,
      resourceId: preference.id,
      resourceType: "WorkingPreference",
      previousState: null,
      newState: "PENDING_ACKNOWLEDGEMENT",
      metadata: { historyId },
    });

    await send(
      {
        userId: otherPartyId,
        type: "COLLABORATION_READY",
        payload: { historyId, preferenceId: preference.id, requiresAcknowledgement: true },
      },
      tx,
    );

    return preference;
  });
}

/**
 * Requirement 20.5 — the other party acknowledges; the timestamp is UTC and the
 * statement becomes CONFIRMED.
 */
export async function acknowledgePreference(
  historyId: string,
  preferenceId: string,
  actorId: string,
): Promise<WorkingPreference> {
  await loadHistoryForParticipant(historyId, actorId);

  const preference = await prisma.workingPreference.findUnique({ where: { id: preferenceId } });
  if (!preference || preference.historyId !== historyId) throw new NotFoundError("WorkingPreference");
  if (preference.authorId === actorId) {
    throw new ForbiddenError(
      "SELF_ACKNOWLEDGEMENT",
      "A working preference must be acknowledged by the other party.",
    );
  }
  if (preference.status === "CONFIRMED") return preference;

  return withTransaction(async (tx) => {
    const confirmed = await tx.workingPreference.update({
      where: { id: preferenceId },
      data: {
        status: "CONFIRMED",
        acknowledgedBy: actorId,
        acknowledgedAt: new Date(),
        authorAcknowledgedAt: preference.authorAcknowledgedAt ?? preference.createdAt,
      },
    });

    await writeAuditLog(tx, {
      eventType: "PREFERENCE_ACKNOWLEDGED",
      actorId,
      resourceId: preferenceId,
      resourceType: "WorkingPreference",
      previousState: "PENDING_ACKNOWLEDGEMENT",
      newState: "CONFIRMED",
      metadata: { historyId, authorId: preference.authorId },
    });

    return confirmed;
  });
}

/**
 * Requirement 20.7 — a CONFIRMED preference may not be edited in place.
 */
export async function updateConfirmedPreference(
  historyId: string,
  preferenceId: string,
  actorId: string,
): Promise<never> {
  await loadHistoryForParticipant(historyId, actorId);
  const preference = await prisma.workingPreference.findUnique({ where: { id: preferenceId } });
  if (!preference || preference.historyId !== historyId) throw new NotFoundError("WorkingPreference");

  throw new ForbiddenError(
    "PREFERENCE_CONFIRMED_MODIFICATION",
    preference.status === "CONFIRMED"
      ? "A confirmed working preference cannot be modified directly. Submit a revised statement to return it to PENDING_ACKNOWLEDGEMENT."
      : "Only confirmed preferences are protected from unilateral modification.",
  );
}

/**
 * Requirement 20.7 — the allowed amendment path: a revised statement that
 * returns the preference to PENDING_ACKNOWLEDGEMENT for both parties.
 */
export async function amendConfirmedPreference(
  historyId: string,
  preferenceId: string,
  actorId: string,
  input: PreferenceInput,
): Promise<WorkingPreference> {
  await loadHistoryForParticipant(historyId, actorId);
  const preference = await prisma.workingPreference.findUnique({ where: { id: preferenceId } });
  if (!preference || preference.historyId !== historyId) throw new NotFoundError("WorkingPreference");
  if (preference.authorId !== actorId) {
    throw new ForbiddenError("NOT_PREFERENCE_AUTHOR", "Only the author may submit a revised statement.");
  }
  if (preference.status !== "CONFIRMED") {
    throw new ConflictError(
      "PREFERENCE_NOT_CONFIRMED",
      "Use the standard edit path for a preference that is not yet confirmed.",
      preference.status,
    );
  }

  return withTransaction(async (tx) => {
    const updated = await tx.workingPreference.update({
      where: { id: preferenceId },
      data: {
        statement: input.statement,
        status: "PENDING_ACKNOWLEDGEMENT",
        acknowledgedBy: null,
        acknowledgedAt: null,
        authorAcknowledgedAt: null,
      },
    });
    await writeAuditLog(tx, {
      eventType: "PREFERENCE_ADDED",
      actorId,
      resourceId: preferenceId,
      resourceType: "WorkingPreference",
      previousState: "CONFIRMED",
      newState: "PENDING_ACKNOWLEDGEMENT",
      metadata: { historyId, reason: "REVISED_STATEMENT" },
    });
    return updated;
  });
}

export interface CollaborationProfile {
  clientId: string;
  freelancerId: string;
  clientName: string;
  freelancerName: string;
  viewerRole: "CLIENT" | "FREELANCER";
  histories: Array<{
    id: string;
    agreementId: string;
    briefTitle: string;
    completedAt: Date;
    totalPaymentAmount: number;
    deliverableCount: number;
  }>;
  confirmedPreferences: Array<{
    id: string;
    historyId: string;
    statement: string;
    authorRole: "CLIENT" | "FREELANCER";
    acknowledgedAt: Date | null;
  }>;
  pendingPreferences: Array<{
    id: string;
    historyId: string;
    statement: string;
    authorRole: "CLIENT" | "FREELANCER";
    authorId: string;
    createdAt: Date;
  }>;
}

/** Requirement 20.3/20.6 — visible only to the two parties in the pair. */
export async function getCollaborationProfile(
  clientId: string,
  freelancerId: string,
  viewerId: string,
): Promise<CollaborationProfile> {
  if (viewerId !== clientId && viewerId !== freelancerId) {
    await recordAccessViolation({
      actorId: viewerId,
      resourceId: `${clientId}:${freelancerId}`,
      resourceType: "CollaborationHistory",
      reason: "NOT_COLLABORATION_PARTICIPANT",
    });
    throw new ForbiddenError("NOT_COLLABORATION_PARTICIPANT", "You are not part of this collaboration pair.");
  }

  const histories = await prisma.collaborationHistory.findMany({
    where: { clientId, freelancerId },
    include: { preferences: true },
    orderBy: { completedAt: "desc" },
  });

  const confirmedPreferences: CollaborationProfile["confirmedPreferences"] = [];
  const pendingPreferences: CollaborationProfile["pendingPreferences"] = [];

  for (const history of histories) {
    for (const preference of history.preferences) {
      const authorRole = preference.authorId === clientId ? "CLIENT" : "FREELANCER";
      if (preference.status === "CONFIRMED") {
        confirmedPreferences.push({
          id: preference.id,
          historyId: history.id,
          statement: preference.statement,
          authorRole,
          acknowledgedAt: preference.acknowledgedAt,
        });
      } else {
        pendingPreferences.push({
          id: preference.id,
          historyId: history.id,
          statement: preference.statement,
          authorRole,
          authorId: preference.authorId,
          createdAt: preference.createdAt,
        });
      }
    }
  }

  const [client, freelancer] = await Promise.all([
    prisma.user.findUnique({ where: { id: clientId }, select: { displayName: true } }),
    prisma.user.findUnique({ where: { id: freelancerId }, select: { displayName: true } }),
  ]);

  return {
    clientId,
    freelancerId,
    clientName: client?.displayName ?? "Client",
    freelancerName: freelancer?.displayName ?? "Freelancer",
    viewerRole: viewerId === clientId ? "CLIENT" : "FREELANCER",
    histories: histories.map((history) => ({
      id: history.id,
      agreementId: history.agreementId,
      briefTitle:
        typeof (history.agreementSnapshot as Record<string, unknown>)?.briefTitle === "string"
          ? ((history.agreementSnapshot as Record<string, unknown>).briefTitle as string)
          : "Completed project",
      completedAt: history.completedAt,
      totalPaymentAmount: Number(history.totalPaymentAmount),
      deliverableCount: asRecordArray(history.deliverables).length,
    })),
    confirmedPreferences,
    pendingPreferences,
  };
}

// ─── AI summaries ────────────────────────────────────────────────────────────

export interface SummaryResult {
  summary: CollaborationSummary | null;
  content: SummaryContent | null;
  cached: boolean;
  notice: string | null;
  generatedAt: Date | null;
}

async function buildSummaryInput(historyId: string) {
  const history = await prisma.collaborationHistory.findUnique({
    where: { id: historyId },
    include: {
      client: { select: { displayName: true } },
      freelancer: { select: { displayName: true } },
      preferences: { where: { status: "CONFIRMED" }, include: { author: { select: { displayName: true } } } },
    },
  });
  if (!history) throw new NotFoundError("CollaborationHistory");

  const snapshot = history.agreementSnapshot as Record<string, unknown>;
  const deliverableRows = asRecordArray(history.deliverables);

  return {
    history,
    input: {
      clientName: history.client.displayName,
      freelancerName: history.freelancer.displayName,
      agreements: [
        {
          id: history.agreementId,
          title: typeof snapshot.briefTitle === "string" ? snapshot.briefTitle : "Completed project",
          completedAt: history.completedAt,
          totalAmount: Number(history.totalPaymentAmount),
          milestoneCount: typeof snapshot.milestoneCount === "number" ? snapshot.milestoneCount : 0,
          deliverableTitles: deliverableRows
            .map((row) => (typeof row.fileName === "string" ? row.fileName : ""))
            .filter(Boolean),
        },
      ],
      confirmedPreferences: history.preferences.map((preference) => ({
        id: preference.id,
        statement: preference.statement,
        authorName: preference.author.displayName,
      })),
    },
  };
}

/**
 * Requirement 21.1/21.6 — 24-hour cache, explicit `forceRegenerate` bypass.
 */
export async function generateCollaborationSummary(
  historyId: string,
  requestorId: string,
  options: { forceRegenerate?: boolean; now?: Date } = {},
): Promise<SummaryResult> {
  await loadHistoryForParticipant(historyId, requestorId);

  const now = options.now ?? new Date();

  if (!options.forceRegenerate) {
    const cached = await prisma.collaborationSummary.findFirst({
      where: { historyId },
      orderBy: { generatedAt: "desc" },
    });
    if (cached && now.getTime() - cached.generatedAt.getTime() <= SUMMARY_CACHE_HOURS * 3_600_000) {
      return {
        summary: cached,
        content: cached.content as unknown as SummaryContent,
        cached: true,
        notice: null,
        generatedAt: cached.generatedAt,
      };
    }
  }

  const { input, history } = await buildSummaryInput(historyId);
  const outcome = await runAISummary(input);

  if (!outcome.available || !outcome.summary) {
    return {
      summary: null,
      content: null,
      cached: false,
      notice: outcome.notice ?? INSUFFICIENT_HISTORY_NOTICE,
      generatedAt: null,
    };
  }

  const created = await withTransaction(async (tx) => {
    const row = await tx.collaborationSummary.create({
      data: {
        historyId,
        requestorId,
        content: outcome.summary as unknown as object,
      },
    });
    await writeAuditLog(tx, {
      eventType: "SUMMARY_GENERATED",
      actorId: requestorId,
      resourceId: row.id,
      resourceType: "CollaborationSummary",
      previousState: null,
      newState: "GENERATED",
      metadata: {
        historyId,
        agreementId: history.agreementId,
        engine: outcome.engine,
        latencyMs: outcome.latencyMs,
        statements: outcome.summary?.statements.length ?? 0,
      },
    });
    return row;
  });

  return {
    summary: created,
    content: created.content as unknown as SummaryContent,
    cached: false,
    notice: null,
    generatedAt: created.generatedAt,
  };
}

/**
 * Requirement 21.5 — flagging records the flag and leaves the history intact.
 */
export async function flagSummaryStatement(
  summaryId: string,
  userId: string,
  input: { statementIndex: number; reason?: string },
): Promise<CollaborationSummary> {
  const summary = await prisma.collaborationSummary.findUnique({ where: { id: summaryId } });
  if (!summary) throw new NotFoundError("CollaborationSummary");
  await loadHistoryForParticipant(summary.historyId, userId);

  const content = summary.content as unknown as SummaryContent;
  const statements = Array.isArray(content?.statements) ? content.statements : [];
  if (input.statementIndex < 0 || input.statementIndex >= statements.length) {
    throw new ValidationError([{ field: "statementIndex", message: "That statement does not exist in this summary." }]);
  }

  const { flags, duplicate } = addFlag(summary.flaggedStatements, {
    statementIndex: input.statementIndex,
    flaggedByUserId: userId,
    flaggedAt: new Date().toISOString(),
    reason: input.reason?.slice(0, 500),
  });
  if (duplicate) return summary;

  return withTransaction(async (tx) => {
    const updated = await tx.collaborationSummary.update({
      where: { id: summaryId },
      data: { flaggedStatements: flags as unknown as object },
    });
    await writeAuditLog(tx, {
      eventType: "SUMMARY_FLAGGED",
      actorId: userId,
      resourceId: summaryId,
      resourceType: "CollaborationSummary",
      previousState: null,
      newState: "FLAGGED",
      metadata: { historyId: summary.historyId, statementIndex: input.statementIndex },
    });
    return updated;
  });
}

// ─── Templates and repeat engagement ─────────────────────────────────────────

/** Requirement 22.1 — captures structure from a completed project. */
export async function createProjectTemplate(
  historyId: string,
  clientId: string,
  input: { name: string },
) {
  const history = await prisma.collaborationHistory.findUnique({ where: { id: historyId } });
  if (!history) throw new NotFoundError("CollaborationHistory");
  if (history.clientId !== clientId) {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: historyId,
      resourceType: "CollaborationHistory",
      reason: "NOT_HISTORY_OWNER",
    });
    throw new ForbiddenError("NOT_HISTORY_OWNER", "Only the Client on this project may create a template.");
  }

  const snapshot = history.agreementSnapshot as Record<string, unknown>;
  const deliverables = asRecordArray(history.deliverables).map((row) =>
    typeof row.fileName === "string" ? row.fileName : "Deliverable",
  );
  const content = (snapshot.content ?? {}) as Record<string, unknown>;

  const templateData = {
    briefTitle: typeof snapshot.briefTitle === "string" ? snapshot.briefTitle : "Repeat project",
    description:
      typeof content.description === "string"
        ? content.description
        : typeof snapshot.briefTitle === "string"
          ? `Repeat engagement based on "${snapshot.briefTitle}".`
          : "Repeat engagement.",
    deliverables: asStringArray(content.deliverables).length > 0 ? asStringArray(content.deliverables) : deliverables,
    lineItems: content.lineItems ?? [],
    timelineDays: typeof content.timelineDays === "number" ? content.timelineDays : 7,
    budgetMin: typeof content.budgetMin === "number" ? content.budgetMin : Number(history.totalPaymentAmount),
    budgetMax:
      typeof content.budgetMax === "number"
        ? content.budgetMax
        : Math.max(Number(history.totalPaymentAmount), 1),
    milestoneCount: typeof snapshot.milestoneCount === "number" ? snapshot.milestoneCount : 1,
    currency: typeof content.currency === "string" ? content.currency : "USD",
  };

  return withTransaction(async (tx) => {
    const template = await tx.projectTemplate.create({
      data: {
        historyId,
        clientId,
        name: input.name,
        templateData: templateData as object,
      },
    });
    await writeAuditLog(tx, {
      eventType: "TEMPLATE_CREATED",
      actorId: clientId,
      resourceId: template.id,
      resourceType: "ProjectTemplate",
      previousState: null,
      newState: "CREATED",
      metadata: { historyId },
    });
    return template;
  });
}

/** Requirement 22.2/22.3 — pre-populates a DRAFT Brief linked to the template. */
export async function createBriefFromTemplate(
  templateId: string,
  clientId: string,
  overrides: Partial<{ title: string; description: string; budgetMin: number; budgetMax: number; targetDate: Date }> = {},
) {
  const template = await prisma.projectTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new NotFoundError("ProjectTemplate");
  if (template.clientId !== clientId) {
    throw new ForbiddenError("NOT_TEMPLATE_OWNER", "Only the owning Client may use this template.");
  }

  const data = template.templateData as Record<string, unknown>;
  const deliverables = asStringArray(data.deliverables);
  const budgetMin = overrides.budgetMin ?? (typeof data.budgetMin === "number" ? data.budgetMin : 1);
  const budgetMax = overrides.budgetMax ?? (typeof data.budgetMax === "number" ? data.budgetMax : budgetMin);
  const targetDate =
    overrides.targetDate ?? new Date(Date.now() + (typeof data.timelineDays === "number" ? data.timelineDays : 14) * 86_400_000);

  return withTransaction(async (tx) => {
    const brief = await tx.brief.create({
      data: {
        clientId,
        title: overrides.title ?? (typeof data.briefTitle === "string" ? data.briefTitle : template.name),
        description:
          overrides.description ??
          (typeof data.description === "string" ? data.description : "Created from a project template."),
        deliverables: (deliverables.length > 0 ? deliverables : ["Deliverable"]) as object,
        budgetMin,
        budgetMax,
        targetDate,
        status: "DRAFT",
        projectTemplateId: template.id,
      },
    });
    await writeAuditLog(tx, {
      eventType: "BRIEF_FROM_TEMPLATE",
      actorId: clientId,
      resourceId: brief.id,
      resourceType: "Brief",
      previousState: null,
      newState: "DRAFT",
      metadata: { templateId: template.id },
    });
    return brief;
  });
}

/**
 * Requirement 22.4/22.5 — repeat invitation with the most recent summary (or
 * the history entry itself when no summary has ever been generated) attached.
 */
export async function sendRepeatInvitation(
  briefId: string,
  clientId: string,
  freelancerId: string,
) {
  const history = await prisma.collaborationHistory.findFirst({
    where: { clientId, freelancerId },
    orderBy: { completedAt: "desc" },
  });
  if (!history) {
    throw new ConflictError(
      "NO_COLLABORATION_HISTORY",
      "There is no completed project with this Freelancer to base a repeat invitation on.",
    );
  }

  const summary = await prisma.collaborationSummary.findFirst({
    where: { historyId: history.id },
    orderBy: { generatedAt: "desc" },
  });

  const invitation = await sendInvitation(clientId, { briefId, freelancerId });

  return withTransaction(async (tx) => {
    const updated = await tx.invitation.update({
      where: { id: invitation.id },
      data: {
        attachmentSummaryId: summary?.id ?? null,
        attachmentHistoryId: history.id,
      },
    });
    await writeAuditLog(tx, {
      eventType: "REPEAT_INVITATION_SENT",
      actorId: clientId,
      resourceId: updated.id,
      resourceType: "Invitation",
      previousState: null,
      newState: "PENDING",
      metadata: {
        briefId,
        freelancerId,
        historyId: history.id,
        attachedSummaryId: summary?.id ?? null,
      },
    });
    await send(
      {
        userId: freelancerId,
        type: "INVITATION_RECEIVED",
        payload: {
          invitationId: updated.id,
          briefId,
          repeat: true,
          attachedSummaryId: summary?.id ?? null,
          attachedHistoryId: history.id,
        },
      },
      tx,
    );
    return updated;
  });
}

/**
 * Requirement 22.5 — the attachment becomes visible once the invitation is
 * accepted.
 */
export async function getInvitationAttachment(invitationId: string, freelancerId: string) {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitation");
  if (invitation.freelancerId !== freelancerId) {
    throw new ForbiddenError("NOT_INVITATION_RECIPIENT", "Only the invited Freelancer may view this attachment.");
  }
  if (invitation.status !== "ACCEPTED") {
    throw new ConflictError(
      "INVITATION_NOT_ACCEPTED",
      "The collaboration context becomes available after you accept the invitation.",
      invitation.status,
    );
  }

  if (invitation.attachmentSummaryId) {
    const summary = await prisma.collaborationSummary.findUnique({
      where: { id: invitation.attachmentSummaryId },
    });
    if (summary) return { kind: "SUMMARY" as const, summary };
  }
  if (invitation.attachmentHistoryId) {
    const history = await prisma.collaborationHistory.findUnique({
      where: { id: invitation.attachmentHistoryId },
    });
    if (history) return { kind: "HISTORY" as const, history };
  }
  return { kind: "NONE" as const, message: "No collaboration context was attached to this invitation." };
}

export async function listTemplatesForClient(clientId: string) {
  return prisma.projectTemplate.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
}

// ─── Read models for the collaboration pages ──────────────────────────────────

export interface CollaborationPair {
  clientId: string;
  freelancerId: string;
  viewerRole: "CLIENT" | "FREELANCER";
  counterpartId: string;
  counterpartName: string;
  projectCount: number;
  lastCompletedAt: Date;
  totalPaymentAmount: number;
  confirmedPreferenceCount: number;
}

/**
 * Requirement 20.3/20.6 — the pairs the viewer belongs to. Histories are already
 * ordered newest-first, so the first entry seen for a pair fixes `lastCompletedAt`.
 */
export async function listCollaborationPairs(userId: string): Promise<CollaborationPair[]> {
  const histories = await prisma.collaborationHistory.findMany({
    where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
    orderBy: { completedAt: "desc" },
    include: { preferences: { select: { status: true } } },
  });
  if (histories.length === 0) return [];

  const pairs = new Map<string, CollaborationPair>();
  for (const history of histories) {
    const key = `${history.clientId}:${history.freelancerId}`;
    const viewerRole = history.clientId === userId ? "CLIENT" : "FREELANCER";
    const confirmed = history.preferences.filter((preference) => preference.status === "CONFIRMED").length;

    const existing = pairs.get(key);
    if (existing) {
      existing.projectCount += 1;
      existing.totalPaymentAmount += Number(history.totalPaymentAmount);
      existing.confirmedPreferenceCount += confirmed;
      continue;
    }

    pairs.set(key, {
      clientId: history.clientId,
      freelancerId: history.freelancerId,
      viewerRole,
      counterpartId: viewerRole === "CLIENT" ? history.freelancerId : history.clientId,
      counterpartName: "",
      projectCount: 1,
      lastCompletedAt: history.completedAt,
      totalPaymentAmount: Number(history.totalPaymentAmount),
      confirmedPreferenceCount: confirmed,
    });
  }

  const counterpartIds = Array.from(new Set(Array.from(pairs.values()).map((pair) => pair.counterpartId)));
  const people = await prisma.user.findMany({
    where: { id: { in: counterpartIds } },
    select: { id: true, displayName: true },
  });
  const names = new Map(people.map((person) => [person.id, person.displayName]));

  return Array.from(pairs.values()).map((pair) => ({
    ...pair,
    counterpartName: names.get(pair.counterpartId) ?? "Counterpart",
  }));
}

export interface CollaborationHistoryView {
  id: string;
  agreementId: string;
  clientId: string;
  freelancerId: string;
  briefTitle: string;
  completedAt: Date;
  totalPaymentAmount: number;
  deliverableCount: number;
  viewerRole: "CLIENT" | "FREELANCER";
  counterpartId: string;
  counterpartName: string;
}

/** A single history entry, resolved for one of its two participants. */
export async function getHistoryForParticipant(
  historyId: string,
  viewerId: string,
): Promise<CollaborationHistoryView> {
  const { history, role, otherPartyId } = await loadHistoryForParticipant(historyId, viewerId);
  const counterpart = await prisma.user.findUnique({
    where: { id: otherPartyId },
    select: { displayName: true },
  });
  const snapshot = history.agreementSnapshot as Record<string, unknown>;

  return {
    id: history.id,
    agreementId: history.agreementId,
    clientId: history.clientId,
    freelancerId: history.freelancerId,
    briefTitle: typeof snapshot.briefTitle === "string" ? snapshot.briefTitle : "Completed project",
    completedAt: history.completedAt,
    totalPaymentAmount: Number(history.totalPaymentAmount),
    deliverableCount: asRecordArray(history.deliverables).length,
    viewerRole: role,
    counterpartId: otherPartyId,
    counterpartName: counterpart?.displayName ?? "Counterpart",
  };
}

export interface SummaryFlag {
  statementIndex: number;
  flaggedByUserId: string;
  flaggedAt: string;
  reason?: string;
}

export interface StoredSummary {
  id: string;
  generatedAt: Date;
  content: SummaryContent;
  flaggedStatements: SummaryFlag[];
}

/**
 * Reads the newest cached summary without touching the AI path, so a page render
 * never blocks on generation. Requirement 21.1's cache is served by the route.
 */
export async function getLatestSummaryForHistory(
  historyId: string,
  viewerId: string,
): Promise<StoredSummary | null> {
  await loadHistoryForParticipant(historyId, viewerId);

  const summary = await prisma.collaborationSummary.findFirst({
    where: { historyId },
    orderBy: { generatedAt: "desc" },
  });
  if (!summary) return null;

  return {
    id: summary.id,
    generatedAt: summary.generatedAt,
    content: summary.content as unknown as SummaryContent,
    flaggedStatements: Array.isArray(summary.flaggedStatements)
      ? (summary.flaggedStatements as unknown as SummaryFlag[])
      : [],
  };
}
