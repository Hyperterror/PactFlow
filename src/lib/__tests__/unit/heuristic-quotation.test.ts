import { describe, expect, it } from "vitest";
import {
  BASELINE_RATE_CARD_SOURCE,
  briefHasSufficientDetail,
  heuristicPricingRecommendation,
  heuristicQuotationDraft,
  tokenize,
} from "@/lib/ai/heuristic";

const target = new Date(Date.now() + 30 * 86_400_000);

function brief(overrides: Partial<Parameters<typeof heuristicQuotationDraft>[0]> = {}) {
  return {
    title: "Marketing site rebuild",
    description: "Rebuild the marketing site with a new component library and content model.",
    deliverables: ["Design system", "Page templates", "Content migration"],
    budgetMin: 3000,
    budgetMax: 5000,
    targetDate: target,
    ...overrides,
  };
}

describe("tokenize", () => {
  it("drops stop words and very short tokens", () => {
    const tokens = tokenize("Rebuild the site with a new design");
    expect(tokens).toEqual(expect.arrayContaining(["rebuild", "site", "design"]));
    expect(tokens).not.toContain("with");
    expect(tokens).not.toContain("new");
    expect(tokens).not.toContain("the");
  });

  it("lowercases and keeps dotted and hyphenated terms", () => {
    expect(tokenize("Node.js, REST-API!")).toEqual(["node.js", "rest-api"]);
  });
});

describe("brief detail gating (Requirement 4.8)", () => {
  it("accepts a brief with at least one deliverable", () => {
    expect(briefHasSufficientDetail({ ...brief(), description: "short" })).toBe(true);
  });

  it("accepts a brief whose description is detailed enough on its own", () => {
    expect(
      briefHasSufficientDetail({
        ...brief(),
        deliverables: [],
        description:
          "Build a responsive product page with checkout flows, search filters, analytics wiring, documentation and a style guide.",
      }),
    ).toBe(true);
  });

  it("rejects an empty brief", () => {
    expect(briefHasSufficientDetail({ ...brief(), deliverables: [], description: "help" })).toBe(false);
  });
});

describe("quotation draft heuristic (Requirements 4.1, 5.1-5.7)", () => {
  it("produces one line item per deliverable", () => {
    const { draft, insufficientDetail } = heuristicQuotationDraft(brief());
    expect(insufficientDetail).toBe(false);
    expect(draft.lineItems).toHaveLength(3);
    expect(draft.lineItems.map((item) => item.description)).toEqual([
      "Design system",
      "Page templates",
      "Content migration",
    ]);
  });

  it("anchors the total on the budget midpoint and keeps each price inside its range", () => {
    const { draft, pricingInsufficientData } = heuristicQuotationDraft(brief());
    expect(pricingInsufficientData).toBe(false);

    const total = draft.lineItems.reduce((sum, item) => sum + item.suggestedPrice, 0);
    // Prices are rounded to the nearest hundred, so the total lands near the midpoint.
    expect(total).toBeGreaterThanOrEqual(3400);
    expect(total).toBeLessThanOrEqual(4600);

    for (const item of draft.lineItems) {
      expect(item.suggestedPrice).toBeGreaterThanOrEqual(1);
      expect(item.priceRangeMin).toBeGreaterThanOrEqual(1);
      expect(item.priceRangeMax).toBeGreaterThanOrEqual(item.suggestedPrice);
      expect(item.suggestedPrice).toBeGreaterThanOrEqual(item.priceRangeMin);
      expect(item.pricingConfidence).toBe("HIGH");
      expect(item.insufficientData).toBe(false);
    }
  });

  it("marks the low-confidence baseline when there is neither budget nor history", () => {
    const { draft, pricingInsufficientData } = heuristicQuotationDraft(
      brief({ budgetMin: 0, budgetMax: 0, historyAverageTotal: null }),
    );
    expect(pricingInsufficientData).toBe(true);
    for (const item of draft.lineItems) {
      expect(item.pricingConfidence).toBe("LOW");
      expect(item.insufficientData).toBe(true);
      expect(item.marketBenchmarkSource).toBe(BASELINE_RATE_CARD_SOURCE);
      expect(item.rationale).toContain("no prior submitted quotations");
    }
  });

  it("uses the freelancer's own history when the brief states no budget", () => {
    const result = heuristicQuotationDraft(
      brief({ budgetMin: 0, budgetMax: 0, historyAverageTotal: 2400, deliverables: ["Landing page"] }),
    );
    expect(result.pricingInsufficientData).toBe(false);
    expect(result.draft.lineItems).toHaveLength(1);
    expect(result.draft.lineItems[0].suggestedPrice).toBeGreaterThan(0);
    expect(result.draft.lineItems[0].rationale).toContain("previously submitted");
  });

  it("refuses to invent line items for an insufficiently detailed brief", () => {
    const { draft, insufficientDetail } = heuristicQuotationDraft(
      brief({ deliverables: [], description: "help" }),
    );
    expect(insufficientDetail).toBe(true);
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0].insufficientData).toBe(true);
    expect(draft.lineItems[0].suggestedPrice).toBeGreaterThan(0);
    expect(draft.notes.toLowerCase()).toContain("manually");
  });

  it("always cites the brief in the references and never submits on its own", () => {
    const { draft } = heuristicQuotationDraft(brief());
    expect(draft.briefReferences).toContain("Marketing site rebuild");
    expect(draft.briefReferences.length).toBeGreaterThan(0);
    expect(draft.notes).toContain("You must review every line item");
    expect(draft.timelineDays).toBeGreaterThan(0);
  });

  it("is deterministic for identical input", () => {
    const first = heuristicQuotationDraft(brief());
    const second = heuristicQuotationDraft(brief());
    expect(second).toEqual(first);
  });
});

describe("pricing recommendation heuristic (Requirements 5.1-5.7)", () => {
  it("returns an insufficient-data marker when the line item has no description", () => {
    const result = heuristicPricingRecommendation({ description: "   " });
    expect(result.insufficientData).toBe(true);
    expect(result.recommendedPrice).toBeUndefined();
    expect(result.rationale.toLowerCase()).toContain("insufficient data");
  });

  it("anchors on a tight budget range with HIGH confidence", () => {
    const result = heuristicPricingRecommendation({
      description: "Landing page",
      briefBudgetMin: 100,
      briefBudgetMax: 140,
    });
    expect(result.insufficientData).toBe(false);
    expect(result.basis).toBe("BRIEF_BUDGET");
    expect(result.pricingConfidence).toBe("HIGH");
    expect(result.recommendedPrice).toBeGreaterThanOrEqual(100);
    expect(result.recommendedPrice).toBeLessThanOrEqual(140);
    expect(result.priceRangeMin).toBe(100);
    expect(result.priceRangeMax).toBe(140);
  });

  it("downgrades to MEDIUM when the budget range is wide", () => {
    const result = heuristicPricingRecommendation({
      description: "Landing page",
      briefBudgetMin: 100,
      briefBudgetMax: 900,
    });
    expect(result.pricingConfidence).toBe("MEDIUM");
    expect(result.recommendedPrice).toBeGreaterThanOrEqual(100);
    expect(result.recommendedPrice).toBeLessThanOrEqual(900);
  });

  it("falls back to submitted history before the baseline rate card", () => {
    const result = heuristicPricingRecommendation({ description: "Landing page", historyAverageTotal: 1000 });
    expect(result.basis).toBe("HISTORY");
    expect(result.pricingConfidence).toBe("MEDIUM");
    expect(result.insufficientData).toBe(false);
    expect(result.recommendedPrice).toBeGreaterThan(0);
  });

  it("labels the baseline rate card when nothing else is available", () => {
    const result = heuristicPricingRecommendation({ description: "Landing page" });
    // A neutral rate card is an estimate, never presented as market evidence.
    expect(result.basis).toBe("BASELINE_ESTIMATE");
    expect(result.insufficientData).toBe(true);
    expect(result.marketBenchmarkSource).toBe(BASELINE_RATE_CARD_SOURCE);
    expect(result.recommendedPrice).toBeGreaterThan(0);
  });
});
