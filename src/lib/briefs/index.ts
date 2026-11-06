import { z } from "zod";
import type { Brief } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog, type TxClient } from "@/lib/audit";
import { BRIEF_TRANSITIONS, assertTransition } from "@/lib/state";
import { assertBriefOwner } from "@/lib/access";
import { revokeAllPendingInvitations } from "@/lib/invitations";

/** Requirement 2.1 — field bounds are enforced by this schema. */
const BriefBaseSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200, "Title must be at most 200 characters."),
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(5000, "Description must be at most 5000 characters."),
  deliverables: z
    .array(
      z.string().trim().min(1, "Deliverable cannot be empty.").max(200, "Deliverable must be at most 200 characters."),
    )
    .min(1, "At least one deliverable is required.")
    .max(20, "At most 20 deliverables are allowed."),
  budgetMin: z.coerce
    .number()
    .min(0.01, "Minimum budget must be at least 0.01.")
    .max(999_999_999.99, "Minimum budget must be at most 999,999,999.99."),
  budgetMax: z.coerce
    .number()
    .min(0.01, "Maximum budget must be at least 0.01.")
    .max(999_999_999.99, "Maximum budget must be at most 999,999,999.99."),
  targetDate: z.coerce.date().refine((date) => date.getTime() > Date.now(), {
    message: "Target completion date must be in the future.",
  }),
});

export const CreateBriefSchema = BriefBaseSchema.refine(
  (data) => data.budgetMin <= data.budgetMax,
  { message: "Minimum budget must be less than or equal to maximum budget.", path: ["budgetMax"] },
);

export const UpdateBriefSchema = BriefBaseSchema.partial().refine(
  (data) => data.budgetMin === undefined || data.budgetMax === undefined || data.budgetMin <= data.budgetMax,
  { message: "Minimum budget must be less than or equal to maximum budget.", path: ["budgetMax"] },
);

export type CreateBriefInput = z.infer<typeof CreateBriefSchema>;
export type UpdateBriefInput = z.infer<typeof UpdateBriefSchema>;

export async function createBrief(clientId: string, input: CreateBriefInput): Promise<Brief> {
  return withTransaction(async (tx) => {
    const brief = await tx.brief.create({
      data: {
        clientId,
        title: input.title,
        description: input.description,
        deliverables: input.deliverables,
        budgetMin: input.budgetMin,
        budgetMax: input.budgetMax,
        targetDate: input.targetDate,
        status: "DRAFT",
      },
    });
    await writeAuditLog(tx, {
      eventType: "BRIEF_CREATED",
      actorId: clientId,
      resourceId: brief.id,
      resourceType: "Brief",
      previousState: null,
      newState: "DRAFT",
    });
    return brief;
  });
}

/** Requirement 2.4 + 2.6 — only DRAFT briefs are editable. */
export async function updateBrief(
  briefId: string,
  actorId: string,
  input: UpdateBriefInput,
): Promise<Brief> {
  const brief = await assertBriefOwner(briefId, actorId);
  if (brief.status !== "DRAFT") {
    throw new ConflictError(
      "BRIEF_NOT_EDITABLE",
      "This Brief is not in an editable state.",
      brief.status,
    );
  }

  const mergedMin = input.budgetMin ?? Number(brief.budgetMin);
  const mergedMax = input.budgetMax ?? Number(brief.budgetMax);
  if (mergedMin > mergedMax) {
    throw new ConflictError(
      "BRIEF_BUDGET_INVALID",
      "Minimum budget must be less than or equal to maximum budget.",
      brief.status,
    );
  }

  return withTransaction(async (tx) => {
    const updated = await tx.brief.update({
      where: { id: briefId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.deliverables !== undefined ? { deliverables: input.deliverables } : {}),
        ...(input.budgetMin !== undefined ? { budgetMin: input.budgetMin } : {}),
        ...(input.budgetMax !== undefined ? { budgetMax: input.budgetMax } : {}),
        ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
      },
    });
    await writeAuditLog(tx, {
      eventType: "BRIEF_UPDATED",
      actorId,
      resourceId: briefId,
      resourceType: "Brief",
      previousState: "DRAFT",
      newState: "DRAFT",
    });
    return updated;
  });
}

/** Requirement 2.5 — DRAFT → OPEN, publication timestamp recorded, edits locked. */
export async function publishBrief(briefId: string, actorId: string): Promise<Brief> {
  const brief = await assertBriefOwner(briefId, actorId);
  assertTransition(BRIEF_TRANSITIONS, brief.status, "OPEN", "BRIEF_NOT_PUBLISHABLE", "Only draft Briefs can be published.");

  return withTransaction(async (tx) => {
    const published = await tx.brief.update({
      where: { id: briefId },
      data: { status: "OPEN", publishedAt: new Date() },
    });
    await writeAuditLog(tx, {
      eventType: "BRIEF_PUBLISHED",
      actorId,
      resourceId: briefId,
      resourceType: "Brief",
      previousState: brief.status,
      newState: "OPEN",
    });
    return published;
  });
}

/** Requirement 3.8 — closing a Brief revokes every pending invitation. */
export async function closeBrief(briefId: string, actorId: string): Promise<Brief> {
  const brief = await assertBriefOwner(briefId, actorId);
  assertTransition(BRIEF_TRANSITIONS, brief.status, "CLOSED", "BRIEF_NOT_CLOSABLE", "Only open Briefs can be closed.");

  const closed = await withTransaction(async (tx) => {
    const updated = await tx.brief.update({ where: { id: briefId }, data: { status: "CLOSED" } });
    await writeAuditLog(tx, {
      eventType: "BRIEF_CLOSED",
      actorId,
      resourceId: briefId,
      resourceType: "Brief",
      previousState: brief.status,
      newState: "CLOSED",
    });
    return updated;
  });

  await revokeAllPendingInvitations(briefId, actorId);
  return closed;
}

export async function cancelBrief(briefId: string, actorId: string): Promise<Brief> {
  const brief = await assertBriefOwner(briefId, actorId);
  assertTransition(BRIEF_TRANSITIONS, brief.status, "CANCELLED", "BRIEF_NOT_CANCELLABLE", "This Brief cannot be cancelled.");

  return withTransaction(async (tx) => {
    const updated = await tx.brief.update({ where: { id: briefId }, data: { status: "CANCELLED" } });
    await writeAuditLog(tx, {
      eventType: "BRIEF_CANCELLED",
      actorId,
      resourceId: briefId,
      resourceType: "Brief",
      previousState: brief.status,
      newState: "CANCELLED",
    });
    return updated;
  });
}

/** Requirement 2.7 — newest first. */
export async function listBriefs(authorId: string): Promise<Brief[]> {
  return prisma.brief.findMany({
    where: { clientId: authorId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBrief(briefId: string): Promise<Brief> {
  const brief = await prisma.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");
  return brief;
}

/** Freelancers see every Brief they were invited to, accepted or not. */
export async function listInvitedBriefs(freelancerId: string): Promise<Brief[]> {
  const invitations = await prisma.invitation.findMany({
    where: { freelancerId },
    include: { brief: true },
    orderBy: { createdAt: "desc" },
  });
  return invitations.map((invitation) => invitation.brief);
}

export async function getBriefWithContext(tx: TxClient, briefId: string): Promise<Brief> {
  const brief = await tx.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");
  return brief;
}
