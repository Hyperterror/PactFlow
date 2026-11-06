import type { Deliverable } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { DELIVERABLE_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertAgreementParticipant, recordAccessViolation } from "@/lib/access";
import { applyWatermark, assertValidPdf, MAX_DELIVERABLE_BYTES } from "@/lib/pdf";
import {
  deleteObject,
  generateStorageKey,
  getObjectBuffer,
  putObject,
  sha256Hex,
} from "@/lib/storage";
import { send } from "@/lib/notifications";

/** Requirement 14.9 — at most 20 deliverable versions per milestone. */
export const MAX_VERSIONS_PER_MILESTONE = 20;

const PDF_CONTENT_TYPE = "application/pdf";

export interface UploadContext {
  milestoneId: string;
  agreementId: string;
  clientId: string;
  freelancerId: string;
}

export async function loadUploadContext(milestoneId: string, freelancerId: string): Promise<UploadContext> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { agreement: true },
  });
  if (!milestone) throw new NotFoundError("Milestone");
  const context = await assertAgreementParticipant(milestone.agreementId, freelancerId);
  if (context.role !== "FREELANCER") {
    await recordAccessViolation({
      actorId: freelancerId,
      resourceId: milestoneId,
      resourceType: "Milestone",
      reason: "WRONG_ROLE",
    });
    throw new ForbiddenError("WRONG_ROLE", "Only the project Freelancer can upload deliverables.");
  }
  return {
    milestoneId,
    agreementId: milestone.agreementId,
    clientId: milestone.agreement.clientId,
    freelancerId: milestone.agreement.freelancerId,
  };
}

/**
 * Requirements 14.1–14.10.
 *
 * Order of operations matters: the file is validated before any storage write,
 * the two storage keys are independently generated UUIDs, the original hash is
 * persisted before the preview exists, and partial failures clean up the bytes
 * that were already written.
 */
export async function uploadDeliverable(
  milestoneId: string,
  freelancerId: string,
  file: Buffer,
  filename: string,
): Promise<Deliverable> {
  const context = await loadUploadContext(milestoneId, freelancerId);

  // Requirement 14.6 — reject before storing any bytes.
  if (file.byteLength > MAX_DELIVERABLE_BYTES) {
    throw new ValidationError([
      { field: "file", message: "File too large: the maximum deliverable size is 50 MB." },
    ]);
  }
  assertValidPdf(file);

  const existingCount = await prisma.deliverable.count({ where: { milestoneId } });
  if (existingCount >= MAX_VERSIONS_PER_MILESTONE) {
    throw new ConflictError(
      "VERSION_LIMIT_REACHED",
      `A milestone supports at most ${MAX_VERSIONS_PER_MILESTONE} deliverable versions.`,
    );
  }

  // Requirements 14.7 / 27.4 — unrelated keys, neither derivable from the other.
  const originalKey = generateStorageKey();
  const previewKey = generateStorageKey();
  const originalHash = sha256Hex(file);

  const deliverable = await withTransaction(async (tx) => {
    const lastVersion = await tx.deliverable.findFirst({
      where: { milestoneId },
      orderBy: { versionNumber: "desc" },
    });
    const created = await tx.deliverable.create({
      data: {
        milestoneId,
        freelancerId,
        versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
        status: "UPLOADING",
        originalKey,
        previewKey,
        originalHash,
        fileName: filename.slice(0, 200),
        fileSizeBytes: file.byteLength,
      },
    });
    await writeAuditLog(tx, {
      eventType: "DELIVERABLE_UPLOADED",
      actorId: freelancerId,
      resourceId: created.id,
      resourceType: "Deliverable",
      previousState: null,
      newState: "UPLOADING",
      metadata: { milestoneId, versionNumber: created.versionNumber, size: file.byteLength },
    });
    return created;
  });

  try {
    await putObject(originalKey, file, PDF_CONTENT_TYPE);

    // Requirement 14.4 — the preview is derived from the very same binary.
    const preview = await applyWatermark(file);
    const previewHash = sha256Hex(preview);
    await putObject(previewKey, preview, PDF_CONTENT_TYPE);

    return await withTransaction(async (tx) => {
      const updated = await tx.deliverable.update({
        where: { id: deliverable.id },
        data: { status: "UPLOADED", previewHash },
      });
      await tx.payment.updateMany({
        where: { milestoneId },
        data: { deliverableId: deliverable.id },
      });
      await writeAuditLog(tx, {
        eventType: "DELIVERABLE_PREVIEW_GENERATED",
        actorId: freelancerId,
        resourceId: deliverable.id,
        resourceType: "Deliverable",
        previousState: "UPLOADING",
        newState: "UPLOADED",
        metadata: { previewHash },
      });
      await send(
        {
          userId: context.clientId,
          type: "DELIVERABLE_REVIEW_NEEDED",
          payload: {
            deliverableId: deliverable.id,
            milestoneId,
            agreementId: context.agreementId,
            fileName: filename,
            versionNumber: deliverable.versionNumber,
          },
        },
        tx,
      );
      return updated;
    });
  } catch (error) {
    // Requirement 14.8 — clean up whatever reached storage.
    await deleteObject(originalKey).catch(() => undefined);
    await deleteObject(previewKey).catch(() => undefined);

    const message = error instanceof Error ? error.message : "Preview generation failed.";
    await withTransaction(async (tx) => {
      await tx.deliverable.update({
        where: { id: deliverable.id },
        data: { status: "PROCESSING_FAILED" },
      });
      await writeAuditLog(tx, {
        eventType: "DELIVERABLE_PREVIEW_FAILED",
        actorId: freelancerId,
        resourceId: deliverable.id,
        resourceType: "Deliverable",
        previousState: "UPLOADING",
        newState: "PROCESSING_FAILED",
        metadata: { message },
      });
      await send(
        {
          userId: freelancerId,
          type: "DELIVERABLE_REVIEW_NEEDED",
          payload: {
            deliverableId: deliverable.id,
            milestoneId,
            failure: "PREVIEW_GENERATION_FAILED",
            message,
            canRegenerate: true,
          },
        },
        tx,
      );
    });

    // A malformed PDF is a user error, not a server failure.
    if (error instanceof Error && /PDF|parse|Expected/i.test(error.message)) {
      throw new ValidationError([
        { field: "file", message: "Invalid format: the PDF could not be parsed." },
      ]);
    }
    throw new ConflictError("PREVIEW_GENERATION_FAILED", message, "PROCESSING_FAILED");
  }
}

/**
 * Requirement 14.10 — regenerates the preview from the stored Original_File
 * without a re-upload.
 */
export async function requestPreviewRegeneration(
  deliverableId: string,
  freelancerId: string,
): Promise<Deliverable> {
  const deliverable = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!deliverable) throw new NotFoundError("Deliverable");
  if (deliverable.freelancerId !== freelancerId) {
    throw new ForbiddenError("NOT_DELIVERABLE_OWNER", "Only the uploading Freelancer may regenerate the preview.");
  }
  if (deliverable.status === "APPROVED") {
    throw new ConflictError("DELIVERABLE_APPROVED", "An approved deliverable cannot be reprocessed.", deliverable.status);
  }

  try {
    const original = await getObjectBuffer(deliverable.originalKey);
    if (sha256Hex(original) !== deliverable.originalHash) {
      throw new ConflictError("ORIGINAL_CORRUPTED", "The stored original failed its integrity check.");
    }
    const preview = await applyWatermark(original);
    await putObject(deliverable.previewKey, preview, PDF_CONTENT_TYPE);

    return await withTransaction(async (tx) => {
      const updated = await tx.deliverable.update({
        where: { id: deliverableId },
        data: { status: "UPLOADED", previewHash: sha256Hex(preview) },
      });
      await writeAuditLog(tx, {
        eventType: "DELIVERABLE_PREVIEW_GENERATED",
        actorId: freelancerId,
        resourceId: deliverableId,
        resourceType: "Deliverable",
        previousState: deliverable.status,
        newState: "UPLOADED",
        metadata: { regenerated: true },
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    await withTransaction(async (tx) => {
      await tx.deliverable.update({ where: { id: deliverableId }, data: { status: "PROCESSING_FAILED" } });
      await writeAuditLog(tx, {
        eventType: "DELIVERABLE_PREVIEW_FAILED",
        actorId: freelancerId,
        resourceId: deliverableId,
        resourceType: "Deliverable",
        previousState: deliverable.status,
        newState: "PROCESSING_FAILED",
        metadata: { regenerated: true },
      });
    });
    throw new ConflictError("PREVIEW_GENERATION_FAILED", "Preview regeneration failed.", "PROCESSING_FAILED");
  }
}

export async function listVersions(milestoneId: string): Promise<Deliverable[]> {
  return prisma.deliverable.findMany({
    where: { milestoneId },
    orderBy: { versionNumber: "desc" },
  });
}

/** Detail access for a Deliverable (Client or Freelancer of the Agreement). */
export async function getDeliverableForViewer(deliverableId: string, userId: string) {
  const deliverable = await prisma.deliverable.findUnique({
    where: { id: deliverableId },
    include: { milestone: { include: { agreement: true } } },
  });
  if (!deliverable) throw new NotFoundError("Deliverable");
  const context = await assertAgreementParticipant(deliverable.milestone.agreementId, userId);
  return { deliverable, ...context };
}

/** Advances a deliverable to a new state under the state machine guard. */
export async function transitionDeliverable(
  deliverable: Deliverable,
  to: Deliverable["status"],
  code: string,
  message: string,
): Promise<void> {
  assertTransition(DELIVERABLE_TRANSITIONS, deliverable.status, to, code, message);
}
