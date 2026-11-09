import { z } from "zod";
import type { RequirementsContent } from "@/lib/requirements/content";

/**
 * Statement of Work, derived — never free-written — from two inputs: the
 * accepted proposal (commercial terms) and the mutually approved requirements
 * version (scope). Pure functions only, so the same draft the parties preview is
 * the one that is rebuilt and stored on submit.
 *
 * Where the two inputs disagree the draft lists a conflict, and submission is
 * refused until a person picks one of the offered resolutions. Nothing here
 * chooses between a conflicting price, date or scope statement on its own.
 */

export interface SowDeliverable {
  id: string;
  title: string;
  requirementIds: string[];
  acceptanceCriteria: string[];
}

export interface SowConflictOption {
  value: string;
  label: string;
}

export interface SowConflict {
  id: "TIMELINE_AFTER_TARGET" | "PRICE_OUTSIDE_BUDGET";
  message: string;
  options: SowConflictOption[];
}

export interface SowDraft {
  engagementId: string;
  quotationId: string;
  briefId: string;
  requirementsVersionId: string;
  requirementsVersionNumber: number;
  title: string;
  objective: string;
  deliverables: SowDeliverable[];
  qualityRequirements: Array<{ id: string; title: string; acceptanceCriteria: string[] }>;
  outOfScope: string[];
  assumptions: Array<{ id: string; text: string; confirmedBy: string | null }>;
  constraints: string[];
  successMeasures: string[];
  lineItems: Array<{ description: string; price: number }>;
  total: number;
  currency: string;
  timelineDays: number;
  briefTargetDate: string;
  proposedEndDate: string;
  budgetMin: number;
  budgetMax: number;
  proposalNotes: string;
  paymentTerms: string;
  changeControl: string;
  conflicts: SowConflict[];
}

export interface SowInputs {
  engagementId: string;
  quotationId: string;
  briefId: string;
  briefTitle: string;
  briefTargetDate: Date;
  budgetMin: number;
  budgetMax: number;
  lineItems: Array<{ description: string; price: number }>;
  timelineDays: number;
  proposalNotes: string;
  currency: string;
  requirementsVersionId: string;
  requirementsVersionNumber: number;
  requirements: RequirementsContent;
  /** The proposed timeline runs from here (agreement start). */
  startDate: Date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const PAYMENT_TERMS =
  "Payment is split across milestones defined on the agreement. The Client pays each milestone through PayPal Checkout; it is captured to the PactFlow PayPal account, and the backend verifies the capture amount and currency before the final file is released. Once that capture is verified, PactFlow sends the Freelancer's share (less any platform fee shown on the milestone) to the Freelancer's PayPal account with PayPal Payouts. PactFlow does not hold funds in escrow: each milestone is paid out as soon as its own capture is verified.";

export const CHANGE_CONTROL =
  "Either party proposes a change in the agreement discussion. The change is classified against this SOW, both parties vote, and an approved change creates a new agreement version. No changed work is binding until both parties approve that version.";

export function buildSowDraft(input: SowInputs): SowDraft {
  const total = input.lineItems.reduce((sum, item) => sum + (Number.isFinite(item.price) ? item.price : 0), 0);
  const proposedEnd = new Date(input.startDate.getTime() + input.timelineDays * 86_400_000);

  const deliverables: SowDeliverable[] = input.requirements.functional.map((requirement, index) => ({
    id: `DEL-${String(index + 1).padStart(3, "0")}`,
    title: requirement.title,
    requirementIds: [requirement.id],
    acceptanceCriteria: requirement.acceptanceCriteria,
  }));

  const conflicts: SowConflict[] = [];
  if (proposedEnd > input.briefTargetDate) {
    conflicts.push({
      id: "TIMELINE_AFTER_TARGET",
      message: `The proposal's ${input.timelineDays}-day timeline ends on ${isoDate(proposedEnd)}, after the brief's target date of ${isoDate(input.briefTargetDate)}.`,
      options: [
        { value: "PROPOSAL_TIMELINE", label: `Use the proposed end date (${isoDate(proposedEnd)})` },
        { value: "BRIEF_TARGET_DATE", label: `Hold the brief's target date (${isoDate(input.briefTargetDate)})` },
      ],
    });
  }
  if (total < input.budgetMin || total > input.budgetMax) {
    conflicts.push({
      id: "PRICE_OUTSIDE_BUDGET",
      message: `The proposal total of ${total.toFixed(2)} ${input.currency} is outside the brief budget of ${input.budgetMin.toFixed(2)}–${input.budgetMax.toFixed(2)} ${input.currency}.`,
      // The SOW cannot invent a price. Accepting the proposal's figure is the
      // only resolution; a different price needs a revised proposal.
      options: [{ value: "PROPOSAL_TOTAL", label: `Accept the proposal total (${total.toFixed(2)} ${input.currency})` }],
    });
  }

  return {
    engagementId: input.engagementId,
    quotationId: input.quotationId,
    briefId: input.briefId,
    requirementsVersionId: input.requirementsVersionId,
    requirementsVersionNumber: input.requirementsVersionNumber,
    title: input.briefTitle,
    objective: input.requirements.objective,
    deliverables,
    qualityRequirements: input.requirements.nonFunctional.map((item) => ({
      id: item.id,
      title: item.title,
      acceptanceCriteria: item.acceptanceCriteria,
    })),
    outOfScope: input.requirements.outOfScope,
    assumptions: input.requirements.assumptions.map((item) => ({
      id: item.id,
      text: item.text,
      confirmedBy: item.confirmedBy ?? null,
    })),
    constraints: input.requirements.constraints,
    successMeasures: input.requirements.successMeasures,
    lineItems: input.lineItems,
    total,
    currency: input.currency,
    timelineDays: input.timelineDays,
    briefTargetDate: isoDate(input.briefTargetDate),
    proposedEndDate: isoDate(proposedEnd),
    budgetMin: input.budgetMin,
    budgetMax: input.budgetMax,
    proposalNotes: input.proposalNotes,
    paymentTerms: PAYMENT_TERMS,
    changeControl: CHANGE_CONTROL,
    conflicts,
  };
}

export const SowSubmitSchema = z.object({
  revisionLimit: z.coerce
    .number()
    .int("Revision limit must be a whole number.")
    .min(1, "Revision limit must be at least 1.")
    .max(10, "Revision limit must be at most 10."),
  resolutions: z.record(z.string(), z.string()).default({}),
});
export type SowSubmitInput = z.input<typeof SowSubmitSchema>;

/** Returns the message for every conflict that lacks a valid resolution. */
export function unresolvedConflicts(draft: SowDraft, resolutions: Record<string, string>): string[] {
  return draft.conflicts
    .filter((conflict) => !conflict.options.some((option) => option.value === resolutions[conflict.id]))
    .map((conflict) => conflict.message);
}

/** The deadline the parties agreed once conflicts are resolved. */
export function agreedEndDate(draft: SowDraft, resolutions: Record<string, string>): string {
  return resolutions.TIMELINE_AFTER_TARGET === "BRIEF_TARGET_DATE" ? draft.briefTargetDate : draft.proposedEndDate;
}
