import { describe, expect, it } from "vitest";
import { agreedEndDate, buildSowDraft, unresolvedConflicts, type SowInputs } from "@/lib/engagements/sow";
import { normalizeContent } from "@/lib/requirements/content";

/** Lifecycle Update PRD FR-06 / AT-07 — traceability and human-resolved conflicts. */

const requirements = normalizeContent(
  {
    objective: "Marketing site",
    functional: [
      { title: "Homepage", acceptanceCriteria: ["Approved by Client"] },
      { title: "Pricing page", acceptanceCriteria: ["Shows two plans"] },
    ],
  },
  "CLIENT",
  [],
);

const inputs: SowInputs = {
  engagementId: "eng",
  quotationId: "quo",
  briefId: "brief",
  briefTitle: "Marketing site",
  briefTargetDate: new Date("2027-03-31T00:00:00.000Z"),
  budgetMin: 2000,
  budgetMax: 5000,
  lineItems: [{ description: "Build", price: 3000 }],
  timelineDays: 21,
  proposalNotes: "",
  currency: "USD",
  requirementsVersionId: "rv",
  requirementsVersionNumber: 2,
  requirements,
  startDate: new Date("2027-01-01T00:00:00.000Z"),
};

describe("buildSowDraft", () => {
  it("maps every deliverable to its requirement IDs and acceptance criteria", () => {
    const draft = buildSowDraft(inputs);
    expect(draft.deliverables).toEqual([
      { id: "DEL-001", title: "Homepage", requirementIds: ["REQ-001"], acceptanceCriteria: ["Approved by Client"] },
      { id: "DEL-002", title: "Pricing page", requirementIds: ["REQ-002"], acceptanceCriteria: ["Shows two plans"] },
    ]);
    expect(draft.total).toBe(3000);
    expect(draft.conflicts).toEqual([]);
    expect(draft.paymentTerms).toMatch(/does not hold funds in escrow/);
  });

  it("surfaces timeline and price conflicts instead of choosing", () => {
    const draft = buildSowDraft({
      ...inputs,
      timelineDays: 120,
      lineItems: [{ description: "Build", price: 9000 }],
    });
    expect(draft.conflicts.map((conflict) => conflict.id)).toEqual(["TIMELINE_AFTER_TARGET", "PRICE_OUTSIDE_BUDGET"]);
    expect(unresolvedConflicts(draft, {})).toHaveLength(2);
    expect(unresolvedConflicts(draft, { TIMELINE_AFTER_TARGET: "NOT_AN_OPTION", PRICE_OUTSIDE_BUDGET: "PROPOSAL_TOTAL" })).toHaveLength(1);
    expect(unresolvedConflicts(draft, { TIMELINE_AFTER_TARGET: "BRIEF_TARGET_DATE", PRICE_OUTSIDE_BUDGET: "PROPOSAL_TOTAL" })).toEqual([]);
    expect(agreedEndDate(draft, { TIMELINE_AFTER_TARGET: "BRIEF_TARGET_DATE" })).toBe("2027-03-31");
    expect(agreedEndDate(draft, { TIMELINE_AFTER_TARGET: "PROPOSAL_TIMELINE" })).toBe(draft.proposedEndDate);
  });
});
