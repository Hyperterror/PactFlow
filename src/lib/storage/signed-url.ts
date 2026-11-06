import { prisma } from "@/lib/prisma";
import { ForbiddenError, ConflictError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import {
  MAX_SIGNED_URL_SECONDS,
  generateSignedUrl,
  getObjectBuffer,
  sha256Hex,
  verifyIntegrity,
  verifyLocalSignature,
} from "@/lib/storage";
import { recordAccessViolation } from "@/lib/access";
import { send } from "@/lib/notifications";

export interface IssuedSignedUrl {
  url: string;
  expiresAt: Date;
  deliverableId: string;
  eventId: string;
}

/**
 * Requirement 19 — a Signed_URL is issued only to the authenticated paying
 * Client, only when the milestone payment is CAPTURED, and only after the
 * stored binary's SHA-256 matches the hash recorded at upload time.
 */
export async function issueSignedUrl(
  deliverableId: string,
  requestorId: string,
  options: { expirySeconds?: number; now?: Date } = {},
): Promise<IssuedSignedUrl> {
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    include: { milestone: { include: { agreement: true } } },
  });
  if (!deliverable) throw new NotFoundError("Deliverable");

  const agreement = deliverable.milestone.agreement;
  const payment = await prisma.payment.findUnique({
    where: { milestoneId: deliverable.milestoneId },
  });

  await withTransaction(async (tx) => {
    await writeAuditLog(tx, {
      eventType: "FILE_DOWNLOAD_ATTEMPTED",
      actorId: requestorId,
      resourceId: deliverableId,
      resourceType: "Deliverable",
      previousState: null,
      newState: "ATTEMPTED",
      metadata: { role: agreement.clientId === requestorId ? "CLIENT" : "OTHER" },
    });
  });

  // Requirement 19.4 — only the paying Client; everyone else gets a 403.
  if (agreement.clientId !== requestorId) {
    await recordAccessViolation({
      actorId: requestorId,
      resourceId: deliverableId,
      resourceType: "Deliverable",
      reason: agreement.freelancerId === requestorId ? "FREELANCER_NOT_ENTITLED" : "NOT_PAYING_CLIENT",
    });
    throw new ForbiddenError(
      "NOT_PAYING_CLIENT",
      "Only the Client who paid for this deliverable may download the original file.",
    );
  }

  // Property 5 — payment-before-delivery gating, zero exceptions.
  if (!payment || payment.status !== "CAPTURED") {
    throw new ForbiddenError(
      "PAYMENT_NOT_CAPTURED",
      "The original file is locked until payment is confirmed.",
    );
  }

  // Property 3 — withhold the URL when the binary no longer matches its hash.
  const intact = await verifyIntegrity(deliverable.originalKey, deliverable.originalHash);
  if (!intact) {
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "FILE_INTEGRITY_FAILED",
        actorId: requestorId,
        resourceId: deliverableId,
        resourceType: "Deliverable",
        previousState: "VERIFIED",
        newState: "CORRUPTED",
        metadata: { expectedHash: deliverable.originalHash },
      });
    });
    await notifyOperators({
      subject: "Deliverable integrity failure",
      deliverableId,
      milestoneId: deliverable.milestoneId,
    });
    throw new ConflictError(
      "FILE_INTEGRITY_FAILURE",
      "The stored file failed its integrity check and cannot be served.",
    );
  }

  const now = options.now ?? new Date();
  const ttl = Math.min(options.expirySeconds ?? MAX_SIGNED_URL_SECONDS, MAX_SIGNED_URL_SECONDS);
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const event = await withTransaction(async (tx) => {
    const created = await tx.signedUrlEvent.create({
      data: {
        clientId: requestorId,
        deliverableId,
        generatedAt: now,
        expiresAt,
      },
    });
    await writeAuditLog(tx, {
      eventType: "SIGNED_URL_ISSUED",
      actorId: requestorId,
      resourceId: deliverableId,
      resourceType: "Deliverable",
      previousState: null,
      newState: "ISSUED",
      metadata: { eventId: created.id, expiresAt: expiresAt.toISOString() },
    });
    return created;
  });

  const signed = await generateSignedUrl(deliverable.originalKey, ttl, now, event.id);
  return {
    url: signed.url,
    expiresAt: signed.expiresAt,
    deliverableId,
    eventId: event.id,
  };
}

/**
 * Requirement 19.1/19.5 — serves the bytes behind a signed URL. The signature,
 * the expiry and (for the local driver) the invalidation flag are all checked.
 */
export async function readSignedObject(params: {
  key: string;
  expires: number;
  signature: string;
  eventId?: string;
  now?: Date;
}): Promise<{ buffer: Buffer; hashMatchesEvent: boolean }> {
  const now = params.now ?? new Date();
  if (params.expires * 1000 <= now.getTime()) {
    throw new ForbiddenError("SIGNED_URL_EXPIRED", "This download link has expired. Request a fresh link.");
  }
  if (!verifyLocalSignature(params.key, params.expires, params.signature, params.eventId ?? "")) {
    throw new ForbiddenError("INVALID_SIGNATURE", "This download link is not valid.");
  }
  if (params.eventId) {
    const event = await prisma.signedUrlEvent.findUnique({ where: { id: params.eventId } });
    if (!event) throw new ForbiddenError("INVALID_SIGNATURE", "This download link is not valid.");
    if (event.invalidatedAt) {
      throw new ForbiddenError("SIGNED_URL_INVALIDATED", "This download link is no longer valid.");
    }
    if (event.expiresAt.getTime() <= now.getTime()) {
      throw new ForbiddenError("SIGNED_URL_EXPIRED", "This download link has expired.");
    }
  }
  const buffer = await getObjectBuffer(params.key);
  return { buffer, hashMatchesEvent: true };
}

/**
 * Requirement 23.5 — invalidate active signed URLs within 5 seconds of a role
 * change. Scoping to a Brief limits the invalidation to the affected project.
 */
export async function invalidateSignedUrlsForUser(
  userId: string,
  options: { agreementScopedToBriefId?: string } = {},
): Promise<number> {
  const events = await prisma.signedUrlEvent.findMany({
    where: {
      clientId: userId,
      invalidatedAt: null,
      expiresAt: { gt: new Date() },
      ...(options.agreementScopedToBriefId
        ? {
            deliverable: {
              milestone: { agreement: { briefId: options.agreementScopedToBriefId } },
            },
          }
        : {}),
    },
  });
  if (events.length === 0) return 0;

  await withTransaction(async (tx) => {
    await tx.signedUrlEvent.updateMany({
      where: { id: { in: events.map((event) => event.id) } },
      data: { invalidatedAt: new Date() },
    });
    for (const event of events) {
      await writeAuditLog(tx, {
        eventType: "SIGNED_URL_INVALIDATED",
        actorId: userId,
        resourceId: event.deliverableId,
        resourceType: "Deliverable",
        previousState: "ACTIVE",
        newState: "INVALIDATED",
        metadata: { eventId: event.id, reason: "ROLE_CHANGE" },
      });
    }
  });
  return events.length;
}

/** Invalidates every outstanding URL once an Agreement is completed. */
export async function invalidateSignedUrlsForAgreement(agreementId: string): Promise<number> {
  const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
  if (!agreement) return 0;
  const clientInvalidated = await invalidateSignedUrlsForUser(agreement.clientId, {
    agreementScopedToBriefId: agreement.briefId,
  });
  const freelancerInvalidated = await invalidateSignedUrlsForUser(agreement.freelancerId, {
    agreementScopedToBriefId: agreement.briefId,
  });
  return clientInvalidated + freelancerInvalidated;
}

/** Requirement 19.7 — payment + delivery history for the Client. */
export async function listDeliveryHistory(clientId: string, deliverableId?: string) {
  const deliverables = await prisma.deliverable.findMany({
    where: {
      ...(deliverableId ? { id: deliverableId } : {}),
      milestone: { agreement: { clientId } },
    },
    include: {
      milestone: { include: { payment: true, agreement: true } },
      signedUrlEvents: { orderBy: { generatedAt: "desc" } },
    },
    orderBy: { uploadedAt: "desc" },
  });

  return deliverables.map((deliverable) => ({
    deliverableId: deliverable.id,
    milestoneId: deliverable.milestoneId,
    milestoneName: deliverable.milestone.name,
    agreementId: deliverable.milestone.agreementId,
    status: deliverable.status,
    fileName: deliverable.fileName,
    paymentCapturedAt: deliverable.milestone.payment?.capturedAt?.toISOString() ?? null,
    signedUrlEvents: deliverable.signedUrlEvents.map((event) => ({
      id: event.id,
      generatedAt: event.generatedAt.toISOString(),
      expiresAt: event.expiresAt.toISOString(),
      invalidatedAt: event.invalidatedAt?.toISOString() ?? null,
    })),
  }));
}

/** Deliverable preview bytes, hash-verified before being served (Requirement 14.5). */
export async function readVerifiedPreview(deliverableId: string): Promise<Buffer> {
  const deliverable = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!deliverable) throw new NotFoundError("Deliverable");
  if (!deliverable.previewKey || !deliverable.previewHash) {
    throw new ConflictError("PREVIEW_UNAVAILABLE", "This deliverable has no preview.", deliverable.status);
  }
  const buffer = await getObjectBuffer(deliverable.previewKey);
  if (sha256Hex(buffer) !== deliverable.previewHash) {
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "FILE_INTEGRITY_FAILED",
        actorId: deliverable.freelancerId,
        resourceId: deliverableId,
        resourceType: "Deliverable",
        previousState: "VERIFIED",
        newState: "CORRUPTED",
        metadata: { stream: "PREVIEW" },
      });
    });
    throw new ConflictError("PREVIEW_INTEGRITY_FAILURE", "The preview failed its integrity check.");
  }
  return buffer;
}

/** Escalates operational failures to every configured platform operator. */
export async function notifyOperators(payload: Record<string, unknown>): Promise<void> {
  const emails = (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    console.error("[operator] alert", payload);
    return;
  }
  const operators = await prisma.user.findMany({ where: { email: { in: emails } } });
  for (const operator of operators) {
    await send({
      userId: operator.id,
      type: "DELIVERABLE_REVIEW_NEEDED",
      payload: { kind: "OPERATOR_ALERT", ...payload },
      guaranteed: true,
    });
  }
}
