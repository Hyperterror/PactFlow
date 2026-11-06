import type {
  Agreement,
  AgreementVersion,
  Brief,
  Deliverable,
  Invitation,
  Milestone,
  Payment,
  Quotation,
} from "@prisma/client";

/**
 * DTO mappers. These are the only shapes returned by the API, which is what
 * guarantees storage keys never reach the browser (Requirement 23.3).
 */

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  return [];
}

export function toBriefDto(brief: Brief) {
  return {
    id: brief.id,
    clientId: brief.clientId,
    title: brief.title,
    description: brief.description,
    deliverables: asStringArray(brief.deliverables),
    budgetMin: Number(brief.budgetMin),
    budgetMax: Number(brief.budgetMax),
    targetDate: brief.targetDate.toISOString(),
    status: brief.status,
    publishedAt: brief.publishedAt?.toISOString() ?? null,
    projectTemplateId: brief.projectTemplateId,
    createdAt: brief.createdAt.toISOString(),
    updatedAt: brief.updatedAt.toISOString(),
  };
}

export type BriefDto = ReturnType<typeof toBriefDto>;

/**
 * The related shapes are structural rather than full `User`/`Brief` rows so the
 * DTO accepts the narrow selects used by list endpoints.
 */
export function toInvitationDto(
  invitation: Invitation & {
    freelancer?: { id: string; displayName: string } | null;
    brief?: { id: string; title: string; status: string } | null;
  },
) {
  return {
    id: invitation.id,
    briefId: invitation.briefId,
    clientId: invitation.clientId,
    freelancerId: invitation.freelancerId,
    token: invitation.token,
    status: invitation.status,
    createdAt: invitation.createdAt.toISOString(),
    freelancer: invitation.freelancer
      ? { id: invitation.freelancer.id, displayName: invitation.freelancer.displayName }
      : undefined,
    brief: invitation.brief
      ? { id: invitation.brief.id, title: invitation.brief.title, status: invitation.brief.status }
      : undefined,
  };
}

export function toQuotationDto(
  quotation: Quotation & {
    freelancer?: { id: string; displayName: string } | null;
    comments?: unknown[];
  },
) {
  return {
    id: quotation.id,
    briefId: quotation.briefId,
    freelancerId: quotation.freelancerId,
    freelancerName: quotation.freelancer?.displayName,
    status: quotation.status,
    lineItems: asRecordArray(quotation.lineItems),
    timelineDays: quotation.timelineDays,
    notes: quotation.notes,
    aiDraftSnapshot: quotation.aiDraftSnapshot ?? null,
    aiSourcedFields: quotation.aiSourcedFields ?? null,
    dismissedPricing: Array.isArray(quotation.dismissedPricing) ? quotation.dismissedPricing : [],
    submittedAt: quotation.submittedAt?.toISOString() ?? null,
    regenerationCount: quotation.regenerationCount,
    createdAt: quotation.createdAt.toISOString(),
  };
}

export type QuotationDto = ReturnType<typeof toQuotationDto>;

export function toAgreementDto(
  agreement: Agreement,
  extras: {
    approvals?: unknown[];
    versions?: AgreementVersion[];
    currentVersion?: AgreementVersion | null;
  } = {},
) {
  return {
    id: agreement.id,
    briefId: agreement.briefId,
    quotationId: agreement.quotationId,
    clientId: agreement.clientId,
    freelancerId: agreement.freelancerId,
    status: agreement.status,
    currentVersion: agreement.currentVersion,
    revisionLimit: agreement.revisionLimit,
    currency: agreement.currency,
    startDate: agreement.startDate?.toISOString() ?? null,
    completedAt: agreement.completedAt?.toISOString() ?? null,
    createdAt: agreement.createdAt.toISOString(),
    approvals: extras.approvals ?? [],
    versions: (extras.versions ?? []).map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      authorRole: version.authorRole,
      createdAt: version.createdAt.toISOString(),
      content: version.content,
    })),
    activeVersionContent: extras.currentVersion?.content ?? null,
  };
}

export type AgreementDto = ReturnType<typeof toAgreementDto>;

export function toMilestoneDto(milestone: Milestone) {
  return {
    id: milestone.id,
    agreementId: milestone.agreementId,
    agreementVersionId: milestone.agreementVersionId,
    name: milestone.name,
    description: milestone.description,
    dueDate: milestone.dueDate.toISOString(),
    paymentAmount: Number(milestone.paymentAmount),
    status: milestone.status,
    deliveredAt: milestone.deliveredAt?.toISOString() ?? null,
    approvedAt: milestone.approvedAt?.toISOString() ?? null,
    overdue:
      milestone.status === "OVERDUE" ||
      (milestone.status === "PENDING" && milestone.dueDate.getTime() < Date.now()),
    createdAt: milestone.createdAt.toISOString(),
  };
}

export type MilestoneDto = ReturnType<typeof toMilestoneDto>;

/**
 * Deliverable DTO. `originalKey` and `previewKey` are deliberately absent.
 */
export function toDeliverableDto(deliverable: Deliverable) {
  return {
    id: deliverable.id,
    milestoneId: deliverable.milestoneId,
    freelancerId: deliverable.freelancerId,
    versionNumber: deliverable.versionNumber,
    status: deliverable.status,
    fileName: deliverable.fileName,
    fileSizeBytes: deliverable.fileSizeBytes,
    originalHash: deliverable.originalHash,
    previewHash: deliverable.previewHash,
    uploadedAt: deliverable.uploadedAt.toISOString(),
    revisionCount: deliverable.revisionCount,
    previewUrl: `/api/deliverables/${deliverable.id}/preview`,
  };
}

export type DeliverableDto = ReturnType<typeof toDeliverableDto>;

/** Payment DTO. The idempotency key stays server-side. */
export function toPaymentDto(payment: Payment) {
  return {
    id: payment.id,
    milestoneId: payment.milestoneId,
    deliverableId: payment.deliverableId,
    status: payment.status,
    amountExpected: Number(payment.amountExpected),
    amountCaptured: payment.amountCaptured === null ? null : Number(payment.amountCaptured),
    currency: payment.currency,
    paypalOrderId: payment.paypalOrderId,
    approveUrl: payment.approveUrl,
    capturedAt: payment.capturedAt?.toISOString() ?? null,
    reviewFlag: payment.reviewFlag,
    createdAt: payment.createdAt.toISOString(),
  };
}

export type PaymentDto = ReturnType<typeof toPaymentDto>;
