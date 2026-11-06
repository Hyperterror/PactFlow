import { z } from "zod";
import type { DiscussionMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog, type TxClient } from "@/lib/audit";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";

/**
 * Requirement 10 — project discussion channel and scope-change input.
 *
 * A message may only be flagged as a formal scope-change proposal at the moment
 * it is created (Requirement 10.3). Formal proposals are created through
 * `submitChangeRequest` in `@/lib/change-requests`, which writes the message and
 * the Change_Request atomically; this module owns ordinary messages, the
 * tag-after-creation rejection, and the delete guard.
 */

export const PostMessageSchema = z.object({
  content: z.string().trim().min(1, "Message cannot be empty.").max(5000, "Message must be at most 5000 characters."),
  /** Only honoured on creation; tagging later is rejected (Requirement 10.3). */
  isScopeProposal: z.boolean().optional(),
});

export type PostMessageInput = z.infer<typeof PostMessageSchema>;

export const SCOPE_TAG_AFTER_CREATION_MESSAGE =
  "A scope-change proposal can only be tagged when the message is created. Post a new message tagged as a scope-change proposal instead.";

export const LINKED_MESSAGE_DELETE_MESSAGE =
  "This message cannot be deleted as it is linked to a scope-change record.";

/** The discussion channel is available while the Agreement is ACTIVE. */
export async function assertDiscussionOpen(agreementId: string, userId: string) {
  const context = await assertAgreementParticipant(agreementId, userId);
  if (context.agreement.status !== "ACTIVE") {
    throw new ConflictError(
      "DISCUSSION_NOT_AVAILABLE",
      "The project discussion is available while the Agreement is active.",
      context.agreement.status,
    );
  }
  return context;
}

/**
 * Requirement 10.2/10.4 — posts an ordinary message and notifies the other
 * party. `isScopeProposal` is rejected here on purpose: formal proposals must
 * go through `submitChangeRequest` so the Change_Request is created atomically.
 */
export async function postMessage(
  agreementId: string,
  authorId: string,
  input: PostMessageInput,
): Promise<DiscussionMessage> {
  const context = await assertDiscussionOpen(agreementId, authorId);

  if (input.isScopeProposal === true) {
    throw new ConflictError(
      "SCOPE_PROPOSAL_REQUIRES_CHANGE_REQUEST",
      "Submit scope-change proposals through the change-request endpoint so the Change_Request record is created with the message.",
      context.agreement.status,
    );
  }

  return writeMessage({
    agreementId,
    authorId,
    content: input.content,
    isScopeProposal: false,
    otherPartyId: context.otherPartyId,
  });
}

interface WriteMessageInput {
  agreementId: string;
  authorId: string;
  content: string;
  isScopeProposal: boolean;
  otherPartyId: string;
}

/**
 * Shared writer used by ordinary messages and by `submitChangeRequest`. Kept
 * here so both paths produce identical audit entries and notifications. Pass
 * `client` to join an existing transaction (used when the Change_Request must
 * be written atomically with its message).
 */
export async function writeMessage(
  input: WriteMessageInput,
  client?: TxClient,
): Promise<DiscussionMessage> {
  return withTransaction(async (tx) => {
    const message = await tx.discussionMessage.create({
      data: {
        agreementId: input.agreementId,
        authorId: input.authorId,
        content: input.content,
        isScopeProposal: input.isScopeProposal,
      },
    });

    await writeAuditLog(tx, {
      eventType: "DISCUSSION_MESSAGE_POSTED",
      actorId: input.authorId,
      resourceId: message.id,
      resourceType: "DiscussionMessage",
      previousState: null,
      newState: input.isScopeProposal ? "SCOPE_PROPOSAL" : "MESSAGE",
      metadata: { agreementId: input.agreementId },
    });

    await send(
      {
        userId: input.otherPartyId,
        type: "DISCUSSION_MESSAGE",
        payload: {
          agreementId: input.agreementId,
          messageId: message.id,
          isScopeProposal: input.isScopeProposal,
        },
      },
      tx,
    );

    return message;
  }, client);
}

/**
 * Requirement 10.3 — tagging an already-posted ordinary message is never
 * permitted. This function exists so the rejection is explicit, testable and
 * impossible to bypass through the API.
 */
export async function tagAsScopeProposal(
  messageId: string,
  actorId: string,
): Promise<never> {
  const message = await prisma.discussionMessage.findUnique({
    where: { id: messageId },
    include: { agreement: { select: { clientId: true, freelancerId: true } } },
  });
  if (!message) throw new NotFoundError("DiscussionMessage");

  const isParticipant =
    message.agreement.clientId === actorId || message.agreement.freelancerId === actorId;
  if (!isParticipant) {
    await recordAccessViolation({
      actorId,
      resourceId: messageId,
      resourceType: "DiscussionMessage",
      reason: "NOT_PROJECT_PARTICIPANT",
    });
    throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this project.");
  }

  throw new ConflictError(
    "SCOPE_TAG_AFTER_CREATION",
    SCOPE_TAG_AFTER_CREATION_MESSAGE,
    message.isScopeProposal ? "SCOPE_PROPOSAL" : "MESSAGE",
  );
}

/**
 * Requirement 10.6 — a message linked to a Change_Request cannot be deleted.
 * Callers author-only; the linked check runs first so the operator sees the
 * scope-change reason rather than a permissions error.
 */
export async function deleteMessage(messageId: string, actorId: string): Promise<void> {
  const message = await prisma.discussionMessage.findUnique({
    where: { id: messageId },
    include: {
      changeRequest: { select: { id: true } },
      agreement: { select: { clientId: true, freelancerId: true } },
    },
  });
  if (!message) throw new NotFoundError("DiscussionMessage");

  if (message.changeRequest) {
    throw new ConflictError("MESSAGE_LINKED_TO_CHANGE_REQUEST", LINKED_MESSAGE_DELETE_MESSAGE);
  }
  if (message.authorId !== actorId) {
    await recordAccessViolation({
      actorId,
      resourceId: messageId,
      resourceType: "DiscussionMessage",
      reason: "NOT_MESSAGE_AUTHOR",
    });
    throw new ForbiddenError("NOT_MESSAGE_AUTHOR", "Only the author may delete this message.");
  }
}

export interface MessageView {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: "CLIENT" | "FREELANCER";
  content: string;
  createdAt: Date;
  isScopeProposal: boolean;
  /** Requirement 10.5 — the badge is absent from ordinary messages. */
  badge: "Scope Change Proposal" | null;
  changeRequestId: string | null;
}

/** Requirement 10.5 — chronological order with the proposal badge. */
export async function listMessages(
  agreementId: string,
  viewerId: string,
): Promise<{ messages: MessageView[]; viewerRole: "CLIENT" | "FREELANCER" }> {
  const context = await assertAgreementParticipant(agreementId, viewerId);

  const rows = await prisma.discussionMessage.findMany({
    where: { agreementId },
    include: {
      author: { select: { id: true, displayName: true } },
      changeRequest: { select: { id: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    viewerRole: context.role,
    messages: rows.map((row) => ({
      id: row.id,
      authorId: row.authorId,
      authorName: row.author.displayName,
      authorRole: row.authorId === context.agreement.clientId ? "CLIENT" : "FREELANCER",
      content: row.content,
      createdAt: row.createdAt,
      isScopeProposal: row.isScopeProposal,
      badge: row.isScopeProposal ? "Scope Change Proposal" : null,
      changeRequestId: row.changeRequest?.id ?? null,
    })),
  };
}
