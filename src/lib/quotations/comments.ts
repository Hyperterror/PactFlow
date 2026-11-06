import { z } from "zod";
import type { Quotation, QuotationComment, QuotationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";

/**
 * Requirement 7 — Quotation comments and clarification tracking.
 *
 * Comment threads exist only while the Quotation is in a review state; the
 * 15-minute edit window is enforced from the persisted `createdAt` so the
 * client clock is never trusted.
 */

/** Requirement 7.5 — the edit window closes 15 minutes after creation. */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

export const COMMENTABLE_STATUSES: QuotationStatus[] = ["SUBMITTED", "UNDER_REVIEW", "SHORTLISTED"];

export const PostCommentSchema = z.object({
  content: z.string().trim().min(1, "Comment cannot be empty.").max(5000, "Comment must be at most 5000 characters."),
  isClarificationRequest: z.boolean().optional(),
  /** Set when this comment answers an existing OPEN clarification request. */
  answersCommentId: z.string().min(1).optional(),
});

export const EditCommentSchema = z.object({
  content: z.string().trim().min(1, "Comment cannot be empty.").max(5000, "Comment must be at most 5000 characters."),
});

export type PostCommentInput = z.infer<typeof PostCommentSchema>;
export type EditCommentInput = z.infer<typeof EditCommentSchema>;

export interface CommentParticipant {
  quotation: Quotation;
  role: "CLIENT" | "FREELANCER";
  otherPartyId: string;
  briefId: string;
}

/** Resolves the viewer's role on a Quotation and enforces participant access. */
export async function resolveCommentParticipant(
  quotationId: string,
  userId: string,
): Promise<CommentParticipant> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { brief: { select: { clientId: true } } },
  });
  if (!quotation) throw new NotFoundError("Quotation");

  const clientId = quotation.brief.clientId;
  if (clientId === userId) {
    return { quotation, role: "CLIENT", otherPartyId: quotation.freelancerId, briefId: quotation.briefId };
  }
  if (quotation.freelancerId === userId) {
    return { quotation, role: "FREELANCER", otherPartyId: clientId, briefId: quotation.briefId };
  }

  await recordAccessViolation({
    actorId: userId,
    resourceId: quotationId,
    resourceType: "Quotation",
    reason: "NOT_PROJECT_PARTICIPANT",
  });
  throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this quotation.");
}

function assertCommentable(quotation: Quotation): void {
  if (!COMMENTABLE_STATUSES.includes(quotation.status)) {
    throw new ConflictError(
      "COMMENTS_CLOSED",
      "Comments are only available while the quotation is under review.",
      quotation.status,
    );
  }
}

/**
 * Requirement 7.1–7.4/7.7 — posts a comment, optionally tagging it as a
 * clarification request or as the answer that resolves one.
 */
export async function postComment(
  quotationId: string,
  authorId: string,
  input: PostCommentInput,
): Promise<QuotationComment> {
  const { quotation, role, otherPartyId } = await resolveCommentParticipant(quotationId, authorId);
  assertCommentable(quotation);

  return withTransaction(async (tx) => {
    const comment = await tx.quotationComment.create({
      data: {
        quotationId,
        authorId,
        content: input.content,
        isClarificationRequest: input.isClarificationRequest === true,
        clarificationStatus: input.isClarificationRequest === true ? "OPEN" : null,
      },
    });

    if (input.answersCommentId) {
      const target = await tx.quotationComment.findUnique({ where: { id: input.answersCommentId } });
      if (!target || target.quotationId !== quotationId) {
        throw new NotFoundError("Clarification request");
      }
      if (target.authorId === authorId) {
        throw new ForbiddenError(
          "SELF_ANSWER",
          "A clarification request must be answered by the other party.",
        );
      }
      if (target.isClarificationRequest && target.clarificationStatus === "OPEN") {
        await tx.quotationComment.update({
          where: { id: target.id },
          data: { clarificationStatus: "RESOLVED", answeredByCommentId: comment.id },
        });
        await tx.quotationComment.update({
          where: { id: comment.id },
          data: { clarificationStatus: "ANSWER" },
        });
      }
    }

    await writeAuditLog(tx, {
      eventType: "COMMENT_POSTED",
      actorId: authorId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: null,
      newState: comment.isClarificationRequest ? "CLARIFICATION_OPEN" : "COMMENT",
      metadata: {
        commentId: comment.id,
        role,
        answersCommentId: input.answersCommentId ?? null,
      },
    });

    // Requirement 7.3 — the other party is notified in-platform.
    await send(
      {
        userId: otherPartyId,
        type: "COMMENT_POSTED",
        payload: {
          quotationId,
          briefId: quotation.briefId,
          commentId: comment.id,
          authorRole: role,
          isClarificationRequest: comment.isClarificationRequest,
        },
      },
      tx,
    );

    return comment;
  });
}

/**
 * Requirement 7.5/7.6 — the author may edit inside the 15-minute window; after
 * that the edit is rejected and the original text stands.
 */
export async function editComment(
  quotationId: string,
  commentId: string,
  authorId: string,
  input: EditCommentInput,
  options: { now?: Date } = {},
): Promise<QuotationComment> {
  await resolveCommentParticipant(quotationId, authorId);

  const comment = await prisma.quotationComment.findUnique({ where: { id: commentId } });
  if (!comment || comment.quotationId !== quotationId) throw new NotFoundError("Comment");
  if (comment.authorId !== authorId) {
    await recordAccessViolation({
      actorId: authorId,
      resourceId: commentId,
      resourceType: "QuotationComment",
      reason: "NOT_COMMENT_AUTHOR",
    });
    throw new ForbiddenError("NOT_COMMENT_AUTHOR", "Only the author may edit this comment.");
  }

  const now = options.now ?? new Date();
  const elapsed = now.getTime() - comment.createdAt.getTime();
  if (elapsed > COMMENT_EDIT_WINDOW_MS) {
    throw new ConflictError(
      "COMMENT_EDIT_WINDOW_CLOSED",
      "The 15-minute edit window for this comment has closed.",
      comment.clarificationStatus ?? "EDIT_CLOSED",
    );
  }

  return withTransaction(async (tx) => {
    const updated = await tx.quotationComment.update({
      where: { id: commentId },
      data: { content: input.content, editedAt: now },
    });
    await writeAuditLog(tx, {
      eventType: "COMMENT_EDITED",
      actorId: authorId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: "COMMENT",
      newState: "COMMENT_EDITED",
      metadata: { commentId, editedAt: now.toISOString() },
    });
    return updated;
  });
}

export interface CommentView {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: "CLIENT" | "FREELANCER";
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  edited: boolean;
  isClarificationRequest: boolean;
  clarificationStatus: string | null;
  answeredByCommentId: string | null;
}

/** Requirement 7.4/7.8 — chronological thread plus the OPEN counter. */
export async function listComments(
  quotationId: string,
  viewerId: string,
): Promise<{ comments: CommentView[]; openClarifications: number }> {
  const participant = await resolveCommentParticipant(quotationId, viewerId);

  const rows = await prisma.quotationComment.findMany({
    where: { quotationId },
    include: { author: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
  });

  const clientId = participant.role === "CLIENT" ? viewerId : participant.quotation.freelancerId;

  const comments: CommentView[] = rows.map((row) => ({
    id: row.id,
    authorId: row.authorId,
    authorName: row.author.displayName,
    authorRole: row.authorId === clientId ? "CLIENT" : "FREELANCER",
    content: row.content,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    edited: row.editedAt !== null,
    isClarificationRequest: row.isClarificationRequest,
    clarificationStatus: row.clarificationStatus,
    answeredByCommentId: row.answeredByCommentId,
  }));

  return {
    comments,
    openClarifications: comments.filter(
      (comment) => comment.isClarificationRequest && comment.clarificationStatus === "OPEN",
    ).length,
  };
}

/** Header counter used by the Quotation detail page (Requirement 7.8). */
export async function openClarificationCount(quotationId: string): Promise<number> {
  return prisma.quotationComment.count({
    where: { quotationId, isClarificationRequest: true, clarificationStatus: "OPEN" },
  });
}

/** Guard used by the PATCH route so over-length text never reaches the DB. */
export function assertCommentLength(content: string): void {
  const length = content.trim().length;
  if (length === 0 || length > 5000) {
    throw new ValidationError([
      { field: "content", message: "Comment must be between 1 and 5000 characters." },
    ]);
  }
}
