import { z } from "zod";
import type { ChangeRequest, ChangeRequestStatus, ScopeLabel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { assertAgreementParticipant, recordAccessViolation, type ProjectRole } from "@/lib/access";
import { send } from "@/lib/notifications";
import { createNewVersion } from "@/lib/agreements";
import { classifyChangeRequest, validateDisputeJustification } from "@/lib/ai/scope-classification";
import { writeMessage } from "@/lib/change-requests/discussion";

/**
 * Requirement 12 — change-request approval workflow.
 *
 * Invariants enforced here:
 *  - at most one Change_Request per Agreement is `SUBMITTED` at any time
 *    (Requirement 12.8 / property 12);
 *  - a single vote never changes the status (Requirement 12.1);
 *  - two approvals create the next Agreement Version, which still needs the
 *    normal dual approval before it becomes ACTIVE (Requirement 12.2/12.4);
 *  - any rejection closes the request and leaves the active version untouched
 *    (Requirement 12.3).
 */

export const DEFAULT_RESPONSE_DEADLINE_DAYS = 7;
export const MIN_RESPONSE_DEADLINE_DAYS = 1;
export const MAX_RESPONSE_DEADLINE_DAYS = 30;
/** Requirement 12.5 — expiry happens 7 days after the reminder. */
export const EXPIRY_GRACE_DAYS = 7;

export const SubmitChangeRequestSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Describe the change you are proposing.")
    .max(5000, "Proposal must be at most 5000 characters."),
  deadlineDays: z.coerce
    .number()
    .int("Deadline must be a whole number of days.")
    .min(MIN_RESPONSE_DEADLINE_DAYS)
    .max(MAX_RESPONSE_DEADLINE_DAYS)
    .optional(),
});

export const VoteSchema = z.object({
  vote: z.enum(["APPROVE", "REJECT"]),
});

export const DisputeSchema = z.object({
  justification: z.string().trim(),
});

export type SubmitChangeRequestInput = z.infer<typeof SubmitChangeRequestSchema>;
export type VoteInput = z.infer<typeof VoteSchema>;

export interface SubmitChangeRequestResult {
  changeRequest: ChangeRequest;
  scopeLabel: ScopeLabel;
  scopeRationale: string;
  classificationTimedOut: boolean;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

async function loadChangeRequestForParticipant(changeRequestId: string, actorId: string) {
  const changeRequest = await prisma.changeRequest.findUnique({
    where: { id: changeRequestId },
    include: {
      agreement: true,
      discussionMessage: true,
      votes: true,
      disputes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!changeRequest) throw new NotFoundError("ChangeRequest");

  const context = await assertAgreementParticipant(changeRequest.agreementId, actorId);
  return { changeRequest, context };
}

function roleOf(agreement: { clientId: string; freelancerId: string }, userId: string): ProjectRole {
  if (agreement.clientId === userId) return "CLIENT";
  if (agreement.freelancerId === userId) return "FREELANCER";
  throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this agreement.");
}

/**
 * Tail of the submission chain per agreement.
 *
 * Requirement 12.8 / Property 12 says at most one Change_Request is `SUBMITTED`
 * at any instant. Two parties can press "propose" at the same moment, and a
 * read-then-insert can let both through, so submissions for one agreement are
 * chained: each waits for the previous one to finish before it re-reads the open
 * request. A single Node process owns this SQLite database, which is what makes
 * an in-process chain sufficient here; a multi-instance deployment would move
 * the same guard into a database constraint.
 */
const submissionChain = new Map<string, Promise<void>>();

async function serialiseSubmission<T>(agreementId: string, task: () => Promise<T>): Promise<T> {
  const previous = submissionChain.get(agreementId) ?? Promise.resolve();
  const run = previous.then(task, task);
  // The chain never carries a rejection forward, so one failed submission cannot
  // poison every later one.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  submissionChain.set(agreementId, settled);
  void settled.then(() => {
    if (submissionChain.get(agreementId) === settled) submissionChain.delete(agreementId);
  });
  return run;
}

/**
 * Requirement 12.1/12.8 + Requirement 10.3 — the proposal message and the
 * Change_Request are written atomically, and the AI classification runs
 * immediately afterwards under its own 20-second budget.
 */
export async function submitChangeRequest(
  agreementId: string,
  submitterId: string,
  input: SubmitChangeRequestInput,
): Promise<SubmitChangeRequestResult> {
  // Serialised per agreement so the open-request check below cannot be beaten by
  // a simultaneous submission from the other party (Property 12).
  return serialiseSubmission(agreementId, () => createSubmission(agreementId, submitterId, input));
}

async function createSubmission(
  agreementId: string,
  submitterId: string,
  input: SubmitChangeRequestInput,
): Promise<SubmitChangeRequestResult> {
  const context = await assertAgreementParticipant(agreementId, submitterId);
  if (context.agreement.status !== "ACTIVE") {
    throw new ConflictError(
      "AGREEMENT_NOT_ACTIVE",
      "Change requests can only be submitted against an active agreement.",
      context.agreement.status,
    );
  }

  const open = await prisma.changeRequest.findFirst({
    where: { agreementId, status: "SUBMITTED" },
    select: { id: true },
  });
  if (open) {
    // Requirement 12.8 / property 12 — serialisation invariant.
    throw new ConflictError(
      "CHANGE_REQUEST_ALREADY_OPEN",
      "An open change request must be resolved before another can be submitted.",
      "SUBMITTED",
    );
  }

  const deadlineDays = input.deadlineDays ?? DEFAULT_RESPONSE_DEADLINE_DAYS;
  const now = new Date();

  const changeRequest = await withTransaction(async (tx) => {
    const message = await writeMessage(
      {
        agreementId,
        authorId: submitterId,
        content: input.content,
        isScopeProposal: true,
        otherPartyId: context.otherPartyId,
      },
      tx,
    );

    const created = await tx.changeRequest.create({
      data: {
        agreementId,
        submitterId,
        discussionMessageId: message.id,
        status: "SUBMITTED",
        responseDeadline: addDays(now, deadlineDays),
      },
    });

    await writeAuditLog(tx, {
      eventType: "CHANGE_REQUEST_SUBMITTED",
      actorId: submitterId,
      resourceId: created.id,
      resourceType: "ChangeRequest",
      previousState: null,
      newState: "SUBMITTED",
      metadata: {
        agreementId,
        discussionMessageId: message.id,
        responseDeadline: created.responseDeadline.toISOString(),
        deadlineDays,
        submitterRole: context.role,
      },
    });

    await send(
      {
        userId: context.otherPartyId,
        type: "CHANGE_REQUEST_SUBMITTED",
        payload: {
          agreementId,
          changeRequestId: created.id,
          responseDeadline: created.responseDeadline.toISOString(),
        },
      },
      tx,
    );

    return created;
  });

  // Requirement 11.2 — classified inside the 20-second window.
  const classification = await classifyChangeRequest(changeRequest.id);

  return {
    changeRequest: classification.changeRequest,
    scopeLabel: classification.classification.label,
    scopeRationale: classification.classification.rationale,
    classificationTimedOut: classification.timedOut,
  };
}

function activeVotes(votes: Array<{ actorId: string; vote: string; retractedAt: Date | null }>) {
  return votes.filter((vote) => vote.retractedAt === null);
}

export interface CastVoteResult {
  changeRequest: ChangeRequest;
  newVersionNumber: number | null;
}

/**
 * Requirement 12.1/12.2/12.3/12.6 — one vote per party per request.
 */
export async function castVote(
  changeRequestId: string,
  actorId: string,
  input: VoteInput,
): Promise<CastVoteResult> {
  const { changeRequest, context } = await loadChangeRequestForParticipant(changeRequestId, actorId);

  if (changeRequest.status !== "SUBMITTED") {
    throw new ConflictError(
      "CHANGE_REQUEST_CLOSED",
      "This change request is no longer open for voting.",
      changeRequest.status,
    );
  }

  const role = roleOf(context.agreement, actorId);

  return withTransaction(async (tx) => {
    const existing = await tx.changeRequestVote.findFirst({
      where: { changeRequestId, actorId, retractedAt: null },
      orderBy: { createdAt: "desc" },
    });

    if (!existing || existing.vote !== input.vote) {
      await tx.changeRequestVote.create({
        data: { changeRequestId, actorId, actorRole: role, vote: input.vote },
      });
    }

    const isClient = role === "CLIENT";
    const updated = await tx.changeRequest.update({
      where: { id: changeRequestId },
      data: isClient
        ? { clientVote: input.vote, clientVotedAt: new Date() }
        : { freelancerVote: input.vote, freelancerVotedAt: new Date() },
    });

    await writeAuditLog(tx, {
      eventType: "CHANGE_REQUEST_VOTED",
      actorId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      previousState: changeRequest.status,
      newState: input.vote,
      metadata: { agreementId: changeRequest.agreementId, actorRole: role, vote: input.vote },
    });

    // Requirement 12.3 — a single rejection closes the request.
    if (input.vote === "REJECT") {
      const rejected = await tx.changeRequest.update({
        where: { id: changeRequestId },
        data: { status: "REJECTED" },
      });
      await writeAuditLog(tx, {
        eventType: "CHANGE_REQUEST_REJECTED",
        actorId,
        resourceId: changeRequestId,
        resourceType: "ChangeRequest",
        previousState: "SUBMITTED",
        newState: "REJECTED",
        metadata: { agreementId: changeRequest.agreementId, actorRole: role },
      });
      await send(
        {
          userId: changeRequest.submitterId,
          type: "CHANGE_REQUEST_VOTED",
          payload: {
            agreementId: changeRequest.agreementId,
            changeRequestId,
            outcome: "REJECTED",
            byRole: role,
          },
        },
        tx,
      );
      return { changeRequest: rejected, newVersionNumber: null };
    }

    // Requirement 12.1 — a single approval does not change the status.
    if (updated.clientVote !== "APPROVE" || updated.freelancerVote !== "APPROVE") {
      return { changeRequest: updated, newVersionNumber: null };
    }

    // Requirement 12.2/12.4 — both approved: create the next version, which
    // still requires dual approval before it becomes ACTIVE.
    const approvedAt = new Date();
    const version = await createNewVersion(
      changeRequest.agreementId,
      actorId,
      {
        changeRequest: {
          id: changeRequestId,
          proposal: changeRequest.discussionMessage.content,
          scopeLabel: changeRequest.scopeLabel,
          scopeRationale: changeRequest.scopeRationale,
          approvedAt: approvedAt.toISOString(),
          approvedBy: ["CLIENT", "FREELANCER"],
        },
      },
      tx,
    );

    const approved = await tx.changeRequest.update({
      where: { id: changeRequestId },
      data: { status: "APPROVED" },
    });

    await writeAuditLog(tx, {
      eventType: "CHANGE_REQUEST_APPROVED",
      actorId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      previousState: "SUBMITTED",
      newState: "APPROVED",
      metadata: {
        agreementId: changeRequest.agreementId,
        versionNumber: version.versionNumber,
      },
    });

    for (const userId of [changeRequest.agreement.clientId, changeRequest.agreement.freelancerId]) {
      await send(
        {
          userId,
          type: "AGREEMENT_READY",
          payload: {
            agreementId: changeRequest.agreementId,
            versionNumber: version.versionNumber,
            source: "CHANGE_REQUEST",
          },
        },
        tx,
      );
    }

    return { changeRequest: approved, newVersionNumber: version.versionNumber };
  });
}

/**
 * Requirement 12.9 — a vote may be retracted only while the other party has not
 * voted. The response deadline is deliberately left untouched.
 */
export async function retractVote(
  changeRequestId: string,
  actorId: string,
): Promise<ChangeRequest> {
  const { changeRequest, context } = await loadChangeRequestForParticipant(changeRequestId, actorId);
  if (changeRequest.status !== "SUBMITTED") {
    throw new ConflictError(
      "CHANGE_REQUEST_CLOSED",
      "This change request is no longer open for voting.",
      changeRequest.status,
    );
  }

  const role = roleOf(context.agreement, actorId);
  const otherRole = role === "CLIENT" ? "FREELANCER" : "CLIENT";
  const votes = activeVotes(changeRequest.votes);
  const own = votes.find((vote) => vote.actorId === actorId);
  const other = votes.find((vote) => vote.actorId !== actorId);

  if (other) {
    throw new ConflictError(
      "VOTE_LOCKED",
      `Your vote cannot be retracted because the ${otherRole.toLowerCase()} has already voted.`,
      changeRequest.status,
    );
  }
  if (!own) throw new NotFoundError("Vote");

  return withTransaction(async (tx) => {
    await tx.changeRequestVote.updateMany({
      where: { changeRequestId, actorId, retractedAt: null },
      data: { retractedAt: new Date() },
    });
    const updated = await tx.changeRequest.update({
      where: { id: changeRequestId },
      data:
        role === "CLIENT"
          ? { clientVote: null, clientVotedAt: null }
          : { freelancerVote: null, freelancerVotedAt: null },
    });
    await writeAuditLog(tx, {
      eventType: "CHANGE_REQUEST_VOTE_RETRACTED",
      actorId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      previousState: own.vote,
      newState: "NO_VOTE",
      metadata: {
        agreementId: changeRequest.agreementId,
        actorRole: role,
        responseDeadline: changeRequest.responseDeadline.toISOString(),
      },
    });
    return updated;
  });
}

/**
 * Requirement 12.7 — the submitter may withdraw while nothing has been voted.
 */
export async function withdrawChangeRequest(
  changeRequestId: string,
  actorId: string,
): Promise<ChangeRequest> {
  const { changeRequest } = await loadChangeRequestForParticipant(changeRequestId, actorId);

  if (changeRequest.submitterId !== actorId) {
    throw new ForbiddenError("NOT_CHANGE_REQUEST_SUBMITTER", "Only the submitter may withdraw this change request.");
  }
  if (changeRequest.status !== "SUBMITTED") {
    throw new ConflictError(
      "CHANGE_REQUEST_CLOSED",
      "This change request is no longer open.",
      changeRequest.status,
    );
  }
  if (activeVotes(changeRequest.votes).length > 0) {
    throw new ConflictError(
      "CHANGE_REQUEST_HAS_VOTES",
      "This change request already has a vote and can no longer be withdrawn.",
      changeRequest.status,
    );
  }

  return withTransaction(async (tx) => {
    const withdrawn = await tx.changeRequest.update({
      where: { id: changeRequestId },
      data: { status: "WITHDRAWN" },
    });
    await writeAuditLog(tx, {
      eventType: "CHANGE_REQUEST_WITHDRAWN",
      actorId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      previousState: "SUBMITTED",
      newState: "WITHDRAWN",
      metadata: { agreementId: changeRequest.agreementId },
    });
    return withdrawn;
  });
}

/**
 * Requirement 11.6 — disputes are recorded next to the label and never alter it.
 */
export async function disputeScopeLabel(
  changeRequestId: string,
  actorId: string,
  justification: string,
): Promise<{ disputeId: string; scopeLabel: ScopeLabel | null }> {
  const { changeRequest } = await loadChangeRequestForParticipant(changeRequestId, actorId);

  const issues = validateDisputeJustification(justification);
  if (issues.length > 0) {
    throw new ValidationError(issues.map((message) => ({ field: "justification", message })));
  }

  return withTransaction(async (tx) => {
    const dispute = await tx.scopeLabelDispute.create({
      data: { changeRequestId, actorId, justification: justification.trim() },
    });
    await writeAuditLog(tx, {
      eventType: "SCOPE_LABEL_DISPUTED",
      actorId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      previousState: changeRequest.scopeLabel ?? null,
      newState: "DISPUTED",
      metadata: { agreementId: changeRequest.agreementId, disputeId: dispute.id },
    });
    return { disputeId: dispute.id, scopeLabel: changeRequest.scopeLabel };
  });
}

export interface ExpiryResult {
  remindersSent: number;
  expired: number;
}

/**
 * Requirement 12.5 — cron entry point. Sends one reminder after the deadline,
 * then expires the request 7 days later if nobody responded.
 */
export async function expireStaleChangeRequests(now: Date = new Date()): Promise<ExpiryResult> {
  const stale = await prisma.changeRequest.findMany({
    where: { status: "SUBMITTED", reminderSentAt: null, responseDeadline: { lte: now } },
    include: { agreement: true, votes: true },
  });

  let remindersSent = 0;
  for (const changeRequest of stale) {
    const voted = new Set(activeVotes(changeRequest.votes).map((vote) => vote.actorId));
    const recipients = [changeRequest.agreement.clientId, changeRequest.agreement.freelancerId].filter(
      (userId) => !voted.has(userId),
    );
    if (recipients.length === 0) continue;

    await withTransaction(async (tx) => {
      await tx.changeRequest.update({
        where: { id: changeRequest.id },
        data: { reminderSentAt: now },
      });
      await writeAuditLog(tx, {
        eventType: "CHANGE_REQUEST_REMINDER",
        actorId: changeRequest.submitterId,
        resourceId: changeRequest.id,
        resourceType: "ChangeRequest",
        previousState: "SUBMITTED",
        newState: "REMINDER_SENT",
        metadata: {
          agreementId: changeRequest.agreementId,
          responseDeadline: changeRequest.responseDeadline.toISOString(),
        },
      });
      for (const userId of recipients) {
        await send(
          {
            userId,
            type: "CHANGE_REQUEST_REMINDER",
            payload: {
              agreementId: changeRequest.agreementId,
              changeRequestId: changeRequest.id,
              responseDeadline: changeRequest.responseDeadline.toISOString(),
            },
          },
          tx,
        );
      }
    });
    remindersSent += 1;
  }

  const expiredCandidates = await prisma.changeRequest.findMany({
    where: {
      status: "SUBMITTED",
      reminderSentAt: { not: null, lte: addDays(now, -EXPIRY_GRACE_DAYS) },
    },
    include: { agreement: true },
  });

  let expired = 0;
  for (const changeRequest of expiredCandidates) {
    await withTransaction(async (tx) => {
      await tx.changeRequest.update({
        where: { id: changeRequest.id },
        data: { status: "EXPIRED" },
      });
      await writeAuditLog(tx, {
        eventType: "CHANGE_REQUEST_EXPIRED",
        actorId: changeRequest.submitterId,
        resourceId: changeRequest.id,
        resourceType: "ChangeRequest",
        previousState: "SUBMITTED",
        newState: "EXPIRED",
        metadata: { agreementId: changeRequest.agreementId },
      });
      for (const userId of [changeRequest.agreement.clientId, changeRequest.agreement.freelancerId]) {
        await send(
          {
            userId,
            type: "CHANGE_REQUEST_EXPIRED",
            payload: { agreementId: changeRequest.agreementId, changeRequestId: changeRequest.id },
          },
          tx,
        );
      }
    });
    expired += 1;
  }

  return { remindersSent, expired };
}

export interface ChangeRequestView {
  id: string;
  agreementId: string;
  status: ChangeRequestStatus;
  scopeLabel: ScopeLabel | null;
  scopeRationale: string | null;
  scopeClassifiedAt: Date | null;
  responseDeadline: Date;
  reminderSentAt: Date | null;
  submitterId: string;
  submitterRole: ProjectRole;
  proposal: string;
  votes: Array<{ actorId: string; actorRole: string; vote: string; createdAt: Date; retractedAt: Date | null }>;
  disputes: Array<{ id: string; actorId: string; justification: string; createdAt: Date }>;
}

/** Requirement 11.3 — detail visible to both parties. */
export async function getChangeRequestDetail(
  changeRequestId: string,
  viewerId: string,
): Promise<ChangeRequestView> {
  const { changeRequest, context } = await loadChangeRequestForParticipant(changeRequestId, viewerId);

  return {
    id: changeRequest.id,
    agreementId: changeRequest.agreementId,
    status: changeRequest.status,
    scopeLabel: changeRequest.scopeLabel,
    scopeRationale: changeRequest.scopeRationale,
    scopeClassifiedAt: changeRequest.scopeClassifiedAt,
    responseDeadline: changeRequest.responseDeadline,
    reminderSentAt: changeRequest.reminderSentAt,
    submitterId: changeRequest.submitterId,
    submitterRole: roleOf(context.agreement, changeRequest.submitterId),
    proposal: changeRequest.discussionMessage.content,
    votes: changeRequest.votes.map((vote) => ({
      actorId: vote.actorId,
      actorRole: vote.actorRole,
      vote: vote.vote,
      createdAt: vote.createdAt,
      retractedAt: vote.retractedAt,
    })),
    disputes: changeRequest.disputes.map((dispute) => ({
      id: dispute.id,
      actorId: dispute.actorId,
      justification: dispute.justification,
      createdAt: dispute.createdAt,
    })),
  };
}

export async function listChangeRequests(agreementId: string, viewerId: string) {
  await assertAgreementParticipant(agreementId, viewerId);
  return prisma.changeRequest.findMany({
    where: { agreementId },
    orderBy: { createdAt: "desc" },
    include: { votes: true, discussionMessage: { select: { content: true, createdAt: true } } },
  });
}

/** Guard used by the reclassify route so only participants can trigger it. */
export async function assertCanReclassify(changeRequestId: string, actorId: string): Promise<void> {
  const changeRequest = await prisma.changeRequest.findUnique({
    where: { id: changeRequestId },
    include: { agreement: { select: { clientId: true, freelancerId: true } } },
  });
  if (!changeRequest) throw new NotFoundError("ChangeRequest");
  if (
    changeRequest.agreement.clientId !== actorId &&
    changeRequest.agreement.freelancerId !== actorId
  ) {
    await recordAccessViolation({
      actorId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      reason: "NOT_PROJECT_PARTICIPANT",
    });
    throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this agreement.");
  }
}
