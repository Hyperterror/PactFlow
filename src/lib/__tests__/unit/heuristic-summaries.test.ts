import { describe, expect, it } from "vitest";
import {
  heuristicCollaborationSummary,
  heuristicComparisonSummary,
  heuristicScopeClassification,
} from "@/lib/ai/heuristic";
import type { ComparisonQuotationLike, CollaborationSummaryInput } from "@/lib/ai/heuristic";

const submitted = new Date("2026-02-01T10:00:00.000Z");

function quotation(overrides: Partial<ComparisonQuotationLike> & { id: string }): ComparisonQuotationLike {
  return {
    freelancerName: `Freelancer ${overrides.id}`,
    total: 1000,
    timelineDays: 14,
    lineItemCount: 3,
    submittedAt: submitted,
    ...overrides,
  };
}

describe("scope classification heuristic (Requirements 11.1-11.5)", () => {
  const activeScope =
    "Design wireframes, build responsive dashboard components, integrate authentication, write documentation.";

  it("labels a proposal that reuses the agreed vocabulary as INCLUDED", () => {
    const result = heuristicScopeClassification({
      proposalText: "Additional dashboard components and responsive wireframes",
      activeScopeText: activeScope,
    });
    expect(result.label).toBe("INCLUDED");
    expect(result.rationale).toContain("%");
  });

  it("labels unrelated work as OUTSIDE_SCOPE", () => {
    const result = heuristicScopeClassification({
      proposalText: "Payroll accounting reconciliation for invoicing",
      activeScopeText: activeScope,
    });
    expect(result.label).toBe("OUTSIDE_SCOPE");
  });

  it("labels a partial overlap as AMBIGUOUS rather than guessing", () => {
    const result = heuristicScopeClassification({
      proposalText: "Dashboard payroll accounting",
      activeScopeText: activeScope,
    });
    expect(result.label).toBe("AMBIGUOUS");
  });

  it("falls back to AMBIGUOUS when the proposal has no substantive terms", () => {
    const result = heuristicScopeClassification({ proposalText: "the a an", activeScopeText: activeScope });
    expect(result.label).toBe("AMBIGUOUS");
    expect(result.rationale).toContain("Manual review");
  });

  it("always returns a non-empty rationale", () => {
    for (const proposalText of ["", "dashboard", "payroll accounting reconciliation", activeScope]) {
      const result = heuristicScopeClassification({ proposalText, activeScopeText: activeScope });
      expect(result.rationale.length).toBeGreaterThan(20);
    }
  });
});

describe("comparison summary heuristic (Requirements 8.4-8.6)", () => {
  const columns = [
    quotation({ id: "q1", freelancerName: "Ada", total: 2400, timelineDays: 21 }),
    quotation({ id: "q2", freelancerName: "Grace", total: 1800, timelineDays: 30 }),
    quotation({ id: "q3", freelancerName: "Linus", total: 3000, timelineDays: 12 }),
  ];

  it("grounds every statement in the quotations that were passed in", () => {
    const summary = heuristicComparisonSummary(columns);
    expect(summary.groundedQuotationIds).toEqual(["q1", "q2", "q3"]);
    expect(summary.summary).toContain("Comparing 3 submitted quotations");
  });

  it("names the cheapest, most expensive and fastest bids", () => {
    const summary = heuristicComparisonSummary(columns);
    const priceRow = summary.keyDifferences.find((difference) => difference.attribute === "Total price");
    expect(priceRow?.comparison).toContain("Grace");
    expect(priceRow?.comparison).toContain("Linus");
    expect(priceRow?.comparison).toContain("$1,800.00");
    expect(priceRow?.comparison).toContain("$3,000.00");
    expect(priceRow?.comparison).toContain("$1,200.00");

    const timelineRow = summary.keyDifferences.find((difference) => difference.attribute === "Timeline");
    expect(timelineRow?.comparison).toContain("12 days");
    expect(timelineRow?.comparison).toContain("Linus");
  });

  it("states that nothing was estimated", () => {
    const summary = heuristicComparisonSummary(columns);
    expect(summary.summary).toContain("nothing has been estimated");
  });

  it("survives an empty selection without inventing a bid", () => {
    const summary = heuristicComparisonSummary([]);
    expect(summary.groundedQuotationIds).toEqual([]);
    expect(summary.summary).toContain("Comparing 0 submitted quotations");
  });

  it("is deterministic for identical input", () => {
    expect(heuristicComparisonSummary(columns)).toEqual(heuristicComparisonSummary(columns));
  });
});

describe("collaboration summary heuristic (Requirements 21.2-21.4)", () => {
  const input: CollaborationSummaryInput = {
    clientName: "Northwind Studio",
    freelancerName: "Ada Lovelace",
    agreements: [
      {
        id: "agreement_1",
        title: "Marketing site rebuild",
        completedAt: new Date("2026-01-20T00:00:00.000Z"),
        totalAmount: 4800,
        milestoneCount: 2,
        deliverableTitles: ["Homepage.pdf", "Design system.pdf"],
      },
    ],
    confirmedPreferences: [
      { id: "pref_1", statement: "Shares annotated drafts before each review call.", authorName: "Northwind Studio" },
    ],
  };

  it("returns null when no project has completed", () => {
    expect(heuristicCollaborationSummary({ ...input, agreements: [] })).toBeNull();
  });

  it("cites the agreement, its deliverables and the confirmed preference", () => {
    const summary = heuristicCollaborationSummary(input);
    expect(summary).not.toBeNull();
    const statements = summary!.statements;
    expect(statements.map((statement) => statement.sourceType)).toEqual([
      "AGREEMENT",
      "DELIVERABLE",
      "WORKING_PREFERENCE",
    ]);
    expect(statements[0].sourceId).toBe("agreement_1");
    expect(statements[1].sourceId).toBe("agreement_1");
    expect(statements[2].sourceId).toBe("pref_1");
  });

  it("only ever cites records that were supplied", () => {
    const summary = heuristicCollaborationSummary(input);
    const allowed = new Set([
      ...input.agreements.map((agreement) => agreement.id),
      ...input.confirmedPreferences.map((preference) => preference.id),
    ]);
    for (const statement of summary!.statements) {
      expect(allowed.has(statement.sourceId)).toBe(true);
      expect(statement.text.length).toBeGreaterThan(0);
    }
  });

  it("summarises the total paid and the confirmed preference count", () => {
    const summary = heuristicCollaborationSummary(input);
    expect(summary!.summary).toContain("$4,800.00");
    expect(summary!.summary).toContain("Marketing site rebuild");
    expect(summary!.summary).toContain("1 working preference is mutually confirmed");
    expect(summary!.summary).toContain("limited to the records cited below");
  });

  it("says so when no preference has been confirmed", () => {
    const summary = heuristicCollaborationSummary({ ...input, confirmedPreferences: [] });
    expect(summary!.summary).toContain("No working preferences have been mutually confirmed yet.");
    expect(summary!.statements.some((statement) => statement.sourceType === "WORKING_PREFERENCE")).toBe(false);
  });
});
