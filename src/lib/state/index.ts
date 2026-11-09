import type {
  AgreementStatus,
  BriefStatus,
  DeliverableStatus,
  EngagementStatus,
  InvitationStatus,
  MilestoneStatus,
  PaymentStatus,
  QuotationStatus,
} from "@prisma/client";
import { ConflictError } from "@/lib/errors";

/**
 * State machines. Every transition is enforced by these tables and every
 * mutation goes through `assertTransition` before writing (Requirements 2.5,
 * 2.6, 4.6, 9.3, 12.3, 15.3).
 */

export const BRIEF_TRANSITIONS: Record<BriefStatus, BriefStatus[]> = {
  DRAFT: ["OPEN", "CANCELLED"],
  OPEN: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export const INVITATION_TRANSITIONS: Record<InvitationStatus, InvitationStatus[]> = {
  PENDING: ["ACCEPTED", "DECLINED", "REVOKED"],
  ACCEPTED: ["DECLINED", "REVOKED"],
  DECLINED: ["PENDING"],
  REVOKED: [],
};

export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  AI_DRAFT: ["DRAFT", "SUBMITTED", "WITHDRAWN"],
  DRAFT: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["UNDER_REVIEW", "SHORTLISTED", "ACCEPTED", "REJECTED", "WITHDRAWN"],
  UNDER_REVIEW: ["SHORTLISTED", "ACCEPTED", "REJECTED", "WITHDRAWN"],
  SHORTLISTED: ["ACCEPTED", "REJECTED", "WITHDRAWN"],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export const AGREEMENT_TRANSITIONS: Record<AgreementStatus, AgreementStatus[]> = {
  PENDING_APPROVAL: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PENDING_APPROVAL", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Lifecycle Update PRD section 8. Saving a new requirements version while one is
 * under review keeps the Engagement in REQUIREMENTS (no transition); revising an
 * approved baseline before the SOW is submitted moves it back to REQUIREMENTS.
 * Once the SOW has produced an Agreement, that Agreement owns the state.
 */
export const ENGAGEMENT_TRANSITIONS: Record<EngagementStatus, EngagementStatus[]> = {
  DISCOVERY: ["REQUIREMENTS", "CANCELLED"],
  REQUIREMENTS: ["REQUIREMENTS_APPROVED", "CANCELLED"],
  REQUIREMENTS_APPROVED: ["REQUIREMENTS", "AGREEMENT", "CANCELLED"],
  AGREEMENT: [],
  CANCELLED: [],
};

export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["DELIVERED", "OVERDUE"],
  OVERDUE: ["DELIVERED", "APPROVED"],
  DELIVERED: ["APPROVED", "OVERDUE", "PENDING"],
  APPROVED: [],
};

export const DELIVERABLE_TRANSITIONS: Record<DeliverableStatus, DeliverableStatus[]> = {
  UPLOADING: ["UPLOADED", "PROCESSING_FAILED"],
  UPLOADED: ["APPROVED", "REVISION_REQUESTED"],
  REVISION_REQUESTED: ["UPLOADED", "APPROVED"],
  PROCESSING_FAILED: ["UPLOADING"],
  APPROVED: [],
};

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ["CAPTURED", "FAILED", "REVIEW_REQUIRED"],
  FAILED: ["PENDING"],
  REVIEW_REQUIRED: ["CAPTURED", "FAILED"],
  CAPTURED: [],
};

export function canTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  return table[from]?.includes(to) ?? false;
}

export function assertTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
  code: string,
  message: string,
): void {
  if (!canTransition(table, from, to)) {
    throw new ConflictError(code, message, from);
  }
}
