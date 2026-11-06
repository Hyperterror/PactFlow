import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

declare const TX_BRAND: unique symbol;

/**
 * A Prisma client that is known to be inside an interactive transaction.
 *
 * `writeAuditLog` accepts only this type, which makes it a compile-time error
 * to record an audit entry outside the transaction that performs the state
 * change (Requirement 24.3). Callers obtain one via `withTransaction`.
 */
export type TxClient = Prisma.TransactionClient & { readonly [TX_BRAND]: true };

type AnyClient = Prisma.TransactionClient;

/**
 * Runs `fn` inside an interactive transaction and hands it a branded client.
 * Nested calls reuse the caller's transaction, so a domain module can call
 * another domain module without splitting atomicity.
 */
export async function withTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  client: AnyClient = prisma,
): Promise<T> {
  const maybeTx = client as AnyClient & { $transaction?: unknown };
  if (typeof maybeTx.$transaction !== "function") {
    // Already inside a transaction — participate rather than nesting.
    return fn(client as TxClient);
  }
  return (client as unknown as typeof prisma).$transaction(
    async (tx) => fn(tx as unknown as TxClient),
    { maxWait: 10_000, timeout: 20_000 },
  );
}

export const AUDIT_EVENT_TYPES = [
  "USER_REGISTERED",
  "LOGIN_SUCCEEDED",
  "LOGIN_FAILED",
  "ACCOUNT_LOCKED",
  "BRIEF_CREATED",
  "BRIEF_UPDATED",
  "BRIEF_PUBLISHED",
  "BRIEF_CLOSED",
  "BRIEF_CANCELLED",
  "INVITATION_SENT",
  "INVITATION_ACCEPTED",
  "INVITATION_DECLINED",
  "INVITATION_REVOKED",
  "QUOTATION_AI_DRAFT_CREATED",
  "QUOTATION_UPDATED",
  "QUOTATION_SUBMITTED",
  "QUOTATION_WITHDRAWN",
  "QUOTATION_SHORTLISTED",
  "QUOTATION_REGENERATED",
  "COMMENT_POSTED",
  "COMMENT_EDITED",
  "COMPARISON_AI_SUMMARY_GENERATED",
  "COMPARISON_ANNOTATION_SAVED",
  "COMPARISON_EXPORTED",
  "AGREEMENT_CREATED",
  "AGREEMENT_VERSION_CREATED",
  "AGREEMENT_APPROVED",
  "AGREEMENT_ACTIVATED",
  "AGREEMENT_COMPLETED",
  "AGREEMENT_CANCELLED",
  "DISCUSSION_MESSAGE_POSTED",
  "CHANGE_REQUEST_SUBMITTED",
  "CHANGE_REQUEST_CLASSIFIED",
  "CHANGE_REQUEST_VOTED",
  "CHANGE_REQUEST_REMINDER",
  "CHANGE_REQUEST_VOTE_RETRACTED",
  "CHANGE_REQUEST_WITHDRAWN",
  "CHANGE_REQUEST_APPROVED",
  "CHANGE_REQUEST_REJECTED",
  "CHANGE_REQUEST_EXPIRED",
  "SCOPE_LABEL_DISPUTED",
  "MILESTONE_CREATED",
  "MILESTONE_DELIVERED",
  "MILESTONE_APPROVED",
  "MILESTONE_OVERDUE",
  "DELIVERABLE_UPLOADED",
  "DELIVERABLE_PREVIEW_GENERATED",
  "DELIVERABLE_PREVIEW_FAILED",
  "DELIVERABLE_APPROVED",
  "DELIVERABLE_REVISION_REQUESTED",
  "DELIVERABLE_REVIEW_REMINDED",
  "PAYMENT_INITIATED",
  "PAYMENT_CAPTURED",
  "PAYMENT_FAILED",
  "PAYMENT_REVIEW_FLAGGED",
  "WEBHOOK_RECEIVED",
  "WEBHOOK_REJECTED",
  "WEBHOOK_DUPLICATE",
  "WEBHOOK_PROCESSED",
  "SIGNED_URL_ISSUED",
  "SIGNED_URL_INVALIDATED",
  "FILE_INTEGRITY_FAILED",
  "FILE_DOWNLOAD_ATTEMPTED",
  "COLLABORATION_HISTORY_CREATED",
  "PREFERENCE_ADDED",
  "PREFERENCE_ACKNOWLEDGED",
  "SUMMARY_GENERATED",
  "SUMMARY_FLAGGED",
  "TEMPLATE_CREATED",
  "BRIEF_FROM_TEMPLATE",
  "REPEAT_INVITATION_SENT",
  "ACCESS_VIOLATION",
  "NOTIFICATION_ESCALATED",
  "AI_GENERATION_FAILED",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/**
 * Reserved identity used for events that no human caused — inbound PayPal
 * webhooks and scheduled jobs. `AuditLog.actorId` is a foreign key to `User`, so
 * the platform needs one real row to attribute those entries to; the row has an
 * unusable password hash and can never be signed in to.
 */
export const SYSTEM_ACTOR_EMAIL = "system@pactflow.local";
export const SYSTEM_ACTOR_NAME = "PactFlow System";

/**
 * Resolves the system actor, creating the row on first use. The row is looked up
 * rather than cached so a database reset cannot leave a dangling id.
 */
export async function getSystemActorId(): Promise<string> {
  const actor = await prisma.user.upsert({
    where: { email: SYSTEM_ACTOR_EMAIL },
    update: {},
    create: {
      email: SYSTEM_ACTOR_EMAIL,
      displayName: SYSTEM_ACTOR_NAME,
      passwordHash: "!",
    },
  });
  return actor.id;
}

export interface AuditEntry {
  eventType: AuditEventType;
  actorId: string;
  resourceId: string;
  resourceType: string;
  previousState: string | null;
  newState: string;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an immutable audit entry inside the caller's transaction.
 * There is deliberately no update or delete counterpart (Requirement 24.5).
 */
export async function writeAuditLog(tx: TxClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      eventType: entry.eventType,
      actorId: entry.actorId,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      previousState: entry.previousState,
      newState: entry.newState,
      metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

/** Read-only audit trail for a single resource, oldest first. */
export async function getAuditTrail(resourceId: string, resourceType?: string) {
  return prisma.auditLog.findMany({
    where: { resourceId, ...(resourceType ? { resourceType } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

/** Operator-only global view (Requirement 24.4). */
export async function listAuditLogs(options: { limit?: number; resourceType?: string } = {}) {
  return prisma.auditLog.findMany({
    where: options.resourceType ? { resourceType: options.resourceType } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 200, 500),
  });
}
