import { z } from "zod";
import type { Quotation, QuotationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { QUOTATION_TRANSITIONS, assertTransition } from "@/lib/state";
import { send } from "@/lib/notifications";
import { recordAccessViolation } from "@/lib/access";
import { assertAcceptedInvitation } from "@/lib/access";
import { asRecordArray } from "@/lib/serializers";

export const PricingConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const LineItemSchema = z.object({
  description: z.string().trim().min(1, "Line item description is required.").max(500),
  price: z.coerce
    .number()
    .min(0, "Price cannot be negative.")
    .max(999_999_999.99, "Price must be at most 999,999,999.99."),
  pricingConfidence: PricingConfidenceSchema.optional(),
  priceRangeMin: z.number().min(0).optional(),
  priceRangeMax: z.number().min(0).optional(),
  rationale: z.string().max(1000).optional(),
  marketBenchmarkSource: z.string().max(300).optional(),
  insufficientData: z.boolean().optional(),
  aiSourced: z.boolean().optional(),
});

export type LineItem = z.infer<typeof LineItemSchema>;

export const QuotationEditSchema = z.object({
  lineItems: z
    .array(LineItemSchema)
    .min(1, "At least one line item is required.")
    .max(50, "At most 50 line items are supported."),
  timelineDays: z.coerce
    .number()
    .int("Timeline must be a whole number of days.")
    .min(1, "Timeline must be at least 1 day.")
    .max(3650, "Timeline must be at most 3650 days."),
  notes: z.string().trim().min(1, "Notes are required.").max(5000),
  /** Line-item indices accepted verbatim from the AI recommendation (Requirement 5.5). */
  acceptedAiPrices: z.array(z.number().int().min(0)).max(50).optional(),
});

export type QuotationEditInput = z.infer<typeof QuotationEditSchema>;

export const DRAFTABLE_STATUSES: QuotationStatus[] = ["AI_DRAFT", "DRAFT"];

export function quotationTotal(lineItems: unknown): number {
  return asRecordArray(lineItems).reduce((sum, item) => {
    const price = typeof item.price === "number" ? item.price : 0;
    return sum + price;
  }, 0);
}

export async function getQuotation(quotationId: string): Promise<Quotation> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new NotFoundError("Quotation");
  return quotation;
}

/** Loads a Quotation together with the Brief it responds to. */
export async function getQuotationWithBrief(quotationId: string) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { brief: true, freelancer: { select: { id: true, displayName: true } } },
  });
  if (!quotation) throw new NotFoundError("Quotation");
  return quotation;
}

export function assertEditable(quotation: Quotation): void {
  if (!DRAFTABLE_STATUSES.includes(quotation.status)) {
    throw new ConflictError(
      "QUOTATION_NOT_EDITABLE",
      "This quotation can no longer be edited.",
      quotation.status,
    );
  }
}

export function assertOwnedByFreelancer(quotation: Quotation, freelancerId: string): void {
  if (quotation.freelancerId !== freelancerId) {
    throw new ForbiddenError("NOT_QUOTATION_AUTHOR", "Only the submitting Freelancer may change this quotation.");
  }
}

/**
 * Requirement 4.5 — every edit keeps the original AI-generated values.
 * The first edit of a manual draft snapshots the pre-edit values so the audit
 * trail is complete either way.
 */
export async function saveAuditedEdit(
  quotationId: string,
  freelancerId: string,
  input: QuotationEditInput,
): Promise<Quotation> {
  const quotation = await getQuotation(quotationId);
  assertOwnedByFreelancer(quotation, freelancerId);
  assertEditable(quotation);

  const accepted = new Set(input.acceptedAiPrices ?? []);
  const existing = asRecordArray(quotation.aiDraftSnapshot ?? quotation.lineItems);
  const lineItems = input.lineItems.map((item, index) => {
    const snapshot = existing[index];
    const aiPrice = snapshot && typeof snapshot.price === "number" ? snapshot.price : undefined;
    const acceptedUnchanged = accepted.has(index) && aiPrice !== undefined && aiPrice === item.price;
    return {
      ...item,
      aiSourced: acceptedUnchanged,
    };
  });

  const aiSourcedFields = lineItems
    .map((item, index) => (item.aiSourced ? index : -1))
    .filter((index) => index >= 0);

  return withTransaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: quotationId },
      data: {
        lineItems,
        timelineDays: input.timelineDays,
        notes: input.notes,
        aiDraftSnapshot:
          quotation.aiDraftSnapshot ??
          ({
            lineItems: quotation.lineItems,
            timelineDays: quotation.timelineDays,
            notes: quotation.notes,
            capturedAt: new Date().toISOString(),
          } as object),
        aiSourcedFields: aiSourcedFields.length > 0 ? aiSourcedFields : undefined,
        status: quotation.status === "AI_DRAFT" ? "DRAFT" : quotation.status,
      },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_UPDATED",
      actorId: freelancerId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: updated.status,
      metadata: { aiSourcedFields },
    });
    return updated;
  });
}

/**
 * Requirement 4.6/4.10 — only an explicit Freelancer action submits; the AI
 * Engine can never trigger this transition.
 */
export async function submitQuotation(quotationId: string, freelancerId: string): Promise<Quotation> {
  const quotation = await getQuotation(quotationId);
  assertOwnedByFreelancer(quotation, freelancerId);
  assertTransition(
    QUOTATION_TRANSITIONS,
    quotation.status,
    "SUBMITTED",
    "QUOTATION_NOT_SUBMITTABLE",
    "This quotation cannot be submitted from its current status.",
  );

  const editable = quotation.lineItems as unknown;
  if (asRecordArray(editable).length === 0) {
    throw new ValidationError([{ field: "lineItems", message: "Add at least one line item before submitting." }]);
  }

  return withTransaction(async (tx) => {
    const submitted = await tx.quotation.update({
      where: { id: quotationId },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_SUBMITTED",
      actorId: freelancerId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: "SUBMITTED",
      metadata: { briefId: quotation.briefId },
    });
    const brief = await tx.brief.findUnique({ where: { id: quotation.briefId } });
    if (brief) {
      await send(
        {
          userId: brief.clientId,
          type: "QUOTATION_SUBMITTED",
          payload: {
            quotationId,
            briefId: quotation.briefId,
            briefTitle: brief.title,
            total: quotationTotal(quotation.lineItems),
          },
        },
        tx,
      );
    }
    return submitted;
  });
}

/** Requirement 6.4 — withdrawal is pushed to open Client views via SSE. */
export async function withdrawQuotation(quotationId: string, freelancerId: string): Promise<Quotation> {
  const quotation = await getQuotation(quotationId);
  assertOwnedByFreelancer(quotation, freelancerId);
  assertTransition(
    QUOTATION_TRANSITIONS,
    quotation.status,
    "WITHDRAWN",
    "QUOTATION_NOT_WITHDRAWABLE",
    "This quotation can no longer be withdrawn.",
  );

  return withTransaction(async (tx) => {
    const withdrawn = await tx.quotation.update({
      where: { id: quotationId },
      data: { status: "WITHDRAWN" },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_WITHDRAWN",
      actorId: freelancerId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: "WITHDRAWN",
    });
    const brief = await tx.brief.findUnique({ where: { id: quotation.briefId } });
    if (brief) {
      await send(
        {
          userId: brief.clientId,
          type: "QUOTATION_WITHDRAWN",
          payload: { quotationId, briefId: quotation.briefId },
        },
        tx,
      );
    }
    return withdrawn;
  });
}

/** Requirement 6.5 — shortlisting is private to the Client and never notifies the Freelancer. */
export async function shortlistQuotation(quotationId: string, clientId: string): Promise<Quotation> {
  const quotation = await getQuotationWithBrief(quotationId);
  if (quotation.brief.clientId !== clientId) {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: quotationId,
      resourceType: "Quotation",
      reason: "NOT_BRIEF_OWNER",
    });
    throw new ForbiddenError("NOT_BRIEF_OWNER", "Only the owning Client may shortlist a quotation.");
  }
  if (quotation.status !== "SUBMITTED" && quotation.status !== "UNDER_REVIEW") {
    throw new ConflictError("QUOTATION_NOT_SHORTLISTABLE", "Only submitted quotations can be shortlisted.", quotation.status);
  }

  return withTransaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: quotationId },
      data: { status: "SHORTLISTED" },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_SHORTLISTED",
      actorId: clientId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: "SHORTLISTED",
    });
    return updated;
  });
}

/**
 * Requirement 6.3/6.6 — the owning Client sees every submitted quotation for a
 * Brief in submission-date ascending order; anyone else gets a 403.
 */
export async function listQuotationsForBrief(briefId: string, clientId: string) {
  const brief = await prisma.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");
  if (brief.clientId !== clientId) {
    await recordAccessViolation({
      actorId: clientId,
      resourceId: briefId,
      resourceType: "Brief",
      reason: "NOT_BRIEF_OWNER",
    });
    throw new ForbiddenError("NOT_BRIEF_OWNER", "Only the owning Client may view quotations for this Brief.");
  }

  return prisma.quotation.findMany({
    where: { briefId, submittedAt: { not: null } },
    include: { freelancer: { select: { id: true, displayName: true } } },
    orderBy: { submittedAt: "asc" },
  });
}

export async function listOwnQuotations(freelancerId: string, briefId?: string) {
  return prisma.quotation.findMany({
    where: { freelancerId, ...(briefId ? { briefId } : {}) },
    include: { brief: { select: { id: true, title: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Detail access for a Quotation: the owning Client or the submitting
 * Freelancer (Requirement 23.2).
 */
export async function getQuotationForViewer(quotationId: string, userId: string) {
  const quotation = await getQuotationWithBrief(quotationId);
  const isClient = quotation.brief.clientId === userId;
  const isFreelancer = quotation.freelancerId === userId;
  if (!isClient && !isFreelancer) {
    await recordAccessViolation({
      actorId: userId,
      resourceId: quotationId,
      resourceType: "Quotation",
      reason: "NOT_PROJECT_PARTICIPANT",
    });
    throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this quotation.");
  }
  return { quotation, viewerRole: isClient ? ("CLIENT" as const) : ("FREELANCER" as const) };
}

/**
 * Requirement 5.8 — dismissing a pricing recommendation never restores it and
 * never affects other line items.
 */
export async function dismissPricingRecommendation(
  quotationId: string,
  freelancerId: string,
  lineItemIndex: number,
): Promise<Quotation> {
  const quotation = await getQuotation(quotationId);
  assertOwnedByFreelancer(quotation, freelancerId);
  assertEditable(quotation);
  const dismissed = new Set<number>(
    Array.isArray(quotation.dismissedPricing)
      ? (quotation.dismissedPricing as unknown[]).filter((value): value is number => typeof value === "number")
      : [],
  );
  dismissed.add(lineItemIndex);

  return withTransaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: quotationId },
      data: { dismissedPricing: [...dismissed].sort((a, b) => a - b) },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_UPDATED",
      actorId: freelancerId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: quotation.status,
      metadata: { dismissedLineItem: lineItemIndex },
    });
    return updated;
  });
}

/** Creates the manual fallback draft used when AI generation is unavailable. */
export async function createDraftQuotation(
  freelancerId: string,
  briefId: string,
  seed: {
    lineItems?: LineItem[];
    timelineDays?: number;
    notes?: string;
    aiDraftSnapshot?: object;
    status?: "AI_DRAFT" | "DRAFT";
  } = {},
): Promise<Quotation> {
  await assertAcceptedInvitation(briefId, freelancerId);
  const existing = await prisma.quotation.findFirst({
    where: { briefId, freelancerId, status: { in: ["AI_DRAFT", "DRAFT"] } },
  });
  if (existing) return existing;

  return withTransaction(async (tx) => {
    const created = await tx.quotation.create({
      data: {
        briefId,
        freelancerId,
        status: seed.status ?? "DRAFT",
        lineItems: (seed.lineItems ?? [
          { description: "", price: 0 },
        ]) as object,
        timelineDays: seed.timelineDays ?? 7,
        notes: seed.notes ?? "",
        aiDraftSnapshot: seed.aiDraftSnapshot,
      },
    });
    await writeAuditLog(tx, {
      eventType: seed.status === "AI_DRAFT" ? "QUOTATION_AI_DRAFT_CREATED" : "QUOTATION_UPDATED",
      actorId: freelancerId,
      resourceId: created.id,
      resourceType: "Quotation",
      previousState: null,
      newState: created.status,
      metadata: { briefId },
    });
    return created;
  });
}
