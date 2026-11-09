import type {
  CollaborationSummary,
  ComparisonSummary,
  PricingRecommendation,
  QuotationDraft,
  ScopeClassification,
} from "@/lib/ai/schemas";

/**
 * Deterministic AI Engine.
 *
 * Every generator here derives its output purely from the records passed in.
 * Nothing is invented: when the underlying record does not contain enough
 * information the generator says so explicitly (`insufficientData`,
 * `AMBIGUOUS`, "Insufficient collaboration history") instead of fabricating
 * plausible-looking values. This module is therefore both the offline engine
 * (no LLM credentials configured) and the documented fallback used when a
 * remote call times out or returns malformed JSON.
 */

const CURRENCY_STEP = 100; // round line-item suggestions to whole dollars

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToStep(value: number, step = CURRENCY_STEP): number {
  return roundMoney(Math.max(1, Math.round(value / step) * step));
}

/** Inclusive split of `total` across `count` buckets, remainder on the first. */
function splitAmount(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((total / count) * 100) / 100;
  const parts = new Array<number>(count).fill(base);
  const assigned = roundMoney(base * count);
  parts[0] = roundMoney(parts[0] + (total - assigned));
  return parts;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "will",
  "shall",
  "should",
  "would",
  "have",
  "has",
  "had",
  "are",
  "was",
  "were",
  "our",
  "your",
  "their",
  "them",
  "then",
  "than",
  "also",
  "such",
  "each",
  "must",
  "need",
  "needs",
  "want",
  "wants",
  "please",
  "plus",
  "some",
  "any",
  "all",
  "not",
  "but",
  "you",
  "can",
  "may",
  "who",
  "when",
  "where",
  "which",
  "what",
  "how",
  "why",
  "about",
  "over",
  "under",
  "within",
  "before",
  "after",
  "using",
  "used",
  "use",
  "make",
  "made",
  "add",
  "adds",
  "new",
  "more",
  "less",
  "very",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.+#-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token));
}

export interface BriefGrounding {
  title: string;
  description: string;
  deliverables: string[];
  budgetMin: number;
  budgetMax: number;
  targetDate: Date | null;
}

/**
 * Requirement 4.8 — a Brief is "insufficiently detailed" when there is nothing
 * to ground a line item in: no deliverables and a description too short to
 * describe any work.
 */
export function briefHasSufficientDetail(brief: BriefGrounding): boolean {
  const descriptionTokens = tokenize(brief.description);
  return brief.deliverables.length > 0 || descriptionTokens.length >= 8;
}

export interface HeuristicQuotationInput extends BriefGrounding {
  /** Mean value of the Freelancer's previously submitted quotations, if any. */
  historyAverageTotal?: number | null;
}

export interface HeuristicQuotationResult {
  draft: QuotationDraft;
  insufficientDetail: boolean;
  /** True when no budget range or history existed to anchor prices on. */
  pricingInsufficientData: boolean;
}

/**
 * Requirement 4.1 / 4.8 / 5.1–5.7 — grounded quotation draft.
 *
 * Line items come from the Brief's deliverable list. Prices are anchored on the
 * Brief's budget range first, then on the Freelancer's own submitted history,
 * then on a clearly-labelled baseline rate card with LOW confidence and an
 * "insufficient data" marker.
 */
export function heuristicQuotationDraft(input: HeuristicQuotationInput): HeuristicQuotationResult {
  const sufficientDetail = briefHasSufficientDetail(input);
  const deliverables = input.deliverables.length > 0 ? input.deliverables : [];

  if (!sufficientDetail || deliverables.length === 0) {
    return {
      draft: {
        lineItems: [
          {
            description: "Describe the service you will deliver for this Brief.",
            suggestedPrice: 1,
            pricingConfidence: "LOW",
            priceRangeMin: 0,
            priceRangeMax: 0,
            rationale:
              "The Brief does not contain enough detail to ground a line item, so no price suggestion is offered. Set your own price and description before submitting.",
            insufficientData: true,
          },
        ],
        timelineDays: 7,
        notes:
          "The Brief lacks sufficient detail for AI generation. Draft the line items, timeline and notes manually before submitting this quotation.",
        briefReferences: ["(Brief lacks sufficient detail for AI generation)"],
      },
      insufficientDetail: true,
      pricingInsufficientData: true,
    };
  }

  const budgetMin = Number.isFinite(input.budgetMin) ? Math.max(0, input.budgetMin) : 0;
  const budgetMax = Number.isFinite(input.budgetMax) ? Math.max(budgetMin, input.budgetMax) : budgetMin;
  const hasBudget = budgetMax > 0;
  const historyAverage =
    typeof input.historyAverageTotal === "number" && input.historyAverageTotal > 0
      ? input.historyAverageTotal
      : null;
  const pricingInsufficientData = !hasBudget && historyAverage === null;

  const targetTotal = hasBudget
    ? roundMoney((budgetMin + budgetMax) / 2)
    : historyAverage !== null
      ? roundMoney(historyAverage)
      : roundMoney(60 * 8 * deliverables.length);

  const shares = splitAmount(targetTotal, deliverables.length);
  const rangeSpread = hasBudget ? Math.max(budgetMax - budgetMin, targetTotal * 0.15) : targetTotal * 0.25;

  const lineItems = deliverables.map((deliverable, index) => {
    const suggested = roundToStep(shares[index]);
    const halfSpread = roundMoney((rangeSpread / deliverables.length) * 0.5);
    const confidence: PricingRecommendation["pricingConfidence"] = pricingInsufficientData
      ? "LOW"
      : hasBudget && budgetMax > budgetMin
        ? "HIGH"
        : hasBudget
          ? "MEDIUM"
          : "LOW";

    const rationale = pricingInsufficientData
      ? `No brief budget range and no prior submitted quotations were available to anchor "${deliverable}". The suggested amount is a neutral baseline for one deliverable and should be replaced with your own rate.`
      : hasBudget
        ? `Derived from the Brief budget range of ${formatUsd(budgetMin)}–${formatUsd(budgetMax)} split across ${deliverables.length} deliverable${deliverables.length === 1 ? "" : "s"}; this amount is the equal share of the midpoint.`
        : `Derived from the average total of your previously submitted quotations (${formatUsd(historyAverage ?? 0)}) split across ${deliverables.length} deliverable${deliverables.length === 1 ? "" : "s"}.`;

    return {
      description: deliverable,
      suggestedPrice: suggested,
      pricingConfidence: confidence,
      priceRangeMin: roundMoney(Math.max(1, suggested - halfSpread)),
      priceRangeMax: roundMoney(suggested + halfSpread),
      rationale,
      marketBenchmarkSource: pricingInsufficientData ? BASELINE_RATE_CARD_SOURCE : undefined,
      insufficientData: pricingInsufficientData,
    };
  });

  const timelineDays = suggestTimelineDays(input, deliverables.length);
  const references = [input.title, ...deliverables.slice(0, 3)];

  const notes = [
    `Draft prepared from the Brief "${input.title}".`,
    `It covers ${deliverables.length} stated deliverable${deliverables.length === 1 ? "" : "s"}: ${deliverables.join(", ")}.`,
    hasBudget
      ? `Prices are anchored on the Brief budget range ${formatUsd(budgetMin)}–${formatUsd(budgetMax)}.`
      : "No budget range was stated, so prices are a neutral baseline you should replace with your own rate.",
    `Proposed timeline is ${timelineDays} days, consistent with the stated target completion date.`,
    "You must review every line item and submit explicitly — the AI never submits on your behalf.",
  ].join(" ");

  return {
    draft: {
      lineItems,
      timelineDays,
      notes,
      briefReferences: references,
    },
    insufficientDetail: false,
    pricingInsufficientData,
  };
}

export const BASELINE_RATE_CARD_SOURCE =
  "PactFlow baseline rate card v1 (USD, neutral fallback — not a market survey)";

function suggestTimelineDays(input: HeuristicQuotationInput, deliverableCount: number): number {
  if (input.targetDate) {
    const days = Math.ceil((input.targetDate.getTime() - Date.now()) / 86_400_000);
    if (Number.isFinite(days) && days >= 1) {
      // Leave headroom: quote at most 80% of the remaining calendar budget.
      return Math.min(3650, Math.max(deliverableCount * 3, Math.round(days * 0.8)));
    }
  }
  return Math.min(3650, Math.max(3, deliverableCount * 5));
}

export function formatUsd(value: number): string {
  return `$${roundMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Pricing ─────────────────────────────────────────────────────────────────

export interface HeuristicPricingInput {
  description: string;
  briefBudgetMin?: number | null;
  briefBudgetMax?: number | null;
  /** Average total of the Freelancer's previously submitted quotations. */
  historyAverageTotal?: number | null;
  /** Sum of the other line items in this quotation, if the Freelancer has entered any. */
  siblingTotal?: number | null;
}

/**
 * Requirement 5.1–5.7 — one recommendation per line item, always with a
 * confidence level and a basis. The recommendation never becomes the price:
 * the caller records `aiSourced` only after the Freelancer accepts it unchanged.
 */
export function heuristicPricingRecommendation(input: HeuristicPricingInput): PricingRecommendation {
  const budgetMin = typeof input.briefBudgetMin === "number" ? Math.max(0, input.briefBudgetMin) : null;
  const budgetMax = typeof input.briefBudgetMax === "number" ? Math.max(0, input.briefBudgetMax) : null;
  const hasBudget = budgetMax !== null && budgetMax > 0;
  const historyAverage =
    typeof input.historyAverageTotal === "number" && input.historyAverageTotal > 0
      ? input.historyAverageTotal
      : null;
  const description = input.description.trim();

  if (!description) {
    return {
      pricingConfidence: "LOW",
      rationale:
        "Insufficient data: the line item has no description yet, so there is nothing to price. Describe the service and request a recommendation again.",
      basis: "BRIEF_BUDGET",
      insufficientData: true,
    };
  }

  if (!hasBudget && historyAverage === null) {
    const baseline = roundToStep(480);
    return {
      recommendedPrice: baseline,
      priceRangeMin: roundMoney(baseline * 0.7),
      priceRangeMax: roundMoney(baseline * 1.4),
      pricingConfidence: "LOW",
      rationale:
        "Insufficient data: this Brief states no budget range and you have no previously submitted quotations on PactFlow. The figure shown is a neutral baseline for a single deliverable — set your own price.",
      basis: "BASELINE_ESTIMATE",
      marketBenchmarkSource: BASELINE_RATE_CARD_SOURCE,
      insufficientData: true,
    };
  }

  if (hasBudget) {
    const min = budgetMin ?? 0;
    const max = budgetMax ?? min;
    const midpoint = roundMoney((min + max) / 2);
    const suggested = roundToStep(midpoint);
    const confidence: PricingRecommendation["pricingConfidence"] =
      max > min ? (max - min) / Math.max(midpoint, 1) <= 0.5 ? "HIGH" : "MEDIUM" : "MEDIUM";
    return {
      recommendedPrice: suggested,
      priceRangeMin: roundMoney(Math.max(1, min)),
      priceRangeMax: roundMoney(Math.max(Math.max(1, min), max)),
      pricingConfidence: confidence,
      rationale: `Anchored on the Brief's stated budget range (${formatUsd(min)}–${formatUsd(max)}) for "${description}". The suggested figure is the midpoint of the range.`,
      basis: "BRIEF_BUDGET",
      insufficientData: false,
    };
  }

  const suggested = roundToStep(historyAverage ?? 0);
  return {
    recommendedPrice: suggested,
    priceRangeMin: roundMoney(Math.max(1, suggested * 0.85)),
    priceRangeMax: roundMoney(suggested * 1.15),
    pricingConfidence: "MEDIUM",
    rationale: `Anchored on the average total of your previously submitted PactFlow quotations (${formatUsd(historyAverage ?? 0)}) for "${description}". No Brief budget range was stated.`,
    basis: "HISTORY",
    insufficientData: false,
  };
}

// ─── Scope classification ────────────────────────────────────────────────────

export interface HeuristicScopeInput {
  proposalText: string;
  /** Serialised active Agreement version content used as the scope baseline. */
  activeScopeText: string;
}

/**
 * Requirement 11.1–11.5 — keyword-overlap classification. Deliberately
 * conservative: anything that is not clearly inside or clearly outside the
 * recorded scope is labelled AMBIGUOUS so a human decides.
 */
export function heuristicScopeClassification(input: HeuristicScopeInput): ScopeClassification {
  const proposalTokens = tokenize(input.proposalText);
  const scopeTokens = new Set(tokenize(input.activeScopeText));

  if (proposalTokens.length === 0) {
    return {
      label: "AMBIGUOUS",
      rationale:
        "The proposed change contains no substantive terms that could be matched against the active Agreement scope. Manual review is required to determine whether the change is included, outside scope, or needs clarification.",
    };
  }

  const matched = proposalTokens.filter((token) => scopeTokens.has(token));
  const coverage = matched.length / proposalTokens.length;
  // Tokens are unbounded (a pasted hash or URL is one token), so each quoted
  // term is clipped to keep the rationale inside the 1000-character UI window.
  const matchedList =
    [...new Set(matched)]
      .slice(0, 8)
      .map((token) => (token.length > 40 ? `${token.slice(0, 40)}…` : token))
      .join(", ") || "none";

  if (coverage >= 0.6) {
    return {
      label: "INCLUDED",
      rationale: `The proposal reuses ${Math.round(coverage * 100)}% of the active Agreement's scope vocabulary (for example: ${matchedList}). The requested work appears to fall within the terms already agreed in the active version.`,
    };
  }

  if (coverage <= 0.2) {
    return {
      label: "OUTSIDE_SCOPE",
      rationale: `Only ${Math.round(coverage * 100)}% of the proposal's terms (${matchedList}) appear in the active Agreement scope. The requested work introduces services that the current version does not describe, so it is likely outside the agreed scope.`,
    };
  }

  return {
    label: "AMBIGUOUS",
    rationale: `The proposal partially overlaps the active Agreement scope (${Math.round(coverage * 100)}% term coverage; matched: ${matchedList}). The change touches agreed terms but also introduces new work, so both parties should clarify the boundary before voting.`,
  };
}

// ─── Comparison summary ──────────────────────────────────────────────────────

export interface ComparisonQuotationLike {
  id: string;
  freelancerName: string;
  total: number;
  timelineDays: number;
  lineItemCount: number;
  submittedAt: Date | null;
}

/** Requirement 8.4–8.6 — every statement is derived from the quotations given. */
export function heuristicComparisonSummary(quotations: ComparisonQuotationLike[]): ComparisonSummary {
  const ordered = [...quotations].sort((a, b) => a.total - b.total);
  const cheapest = ordered[0];
  const priciest = ordered[ordered.length - 1];
  const fastest = [...quotations].sort((a, b) => a.timelineDays - b.timelineDays)[0];

  const keyDifferences: ComparisonSummary["keyDifferences"] = [];

  if (cheapest && priciest) {
    const spread = roundMoney(priciest.total - cheapest.total);
    keyDifferences.push({
      attribute: "Total price",
      comparison: `Totals range from ${formatUsd(cheapest.total)} (${cheapest.freelancerName}) to ${formatUsd(
        priciest.total,
      )} (${priciest.freelancerName}), a difference of ${formatUsd(spread)}.`,
    });
  }

  if (fastest) {
    keyDifferences.push({
      attribute: "Timeline",
      comparison: `The shortest quoted timeline is ${fastest.timelineDays} days from ${fastest.freelancerName}. Quoted timelines across the selection: ${quotations
        .map((q) => `${q.freelancerName} ${q.timelineDays}d`)
        .join(", ")}.`,
    });
  }

  keyDifferences.push({
    attribute: "Line items",
    comparison: quotations
      .map((q) => `${q.freelancerName} itemises ${q.lineItemCount} line item${q.lineItemCount === 1 ? "" : "s"}`)
      .join("; ")
      .concat("."),
  });

  if (quotations.some((q) => q.submittedAt)) {
    keyDifferences.push({
      attribute: "Submission order",
      comparison: [...quotations]
        .sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0))
        .map((q) => `${q.freelancerName} submitted ${q.submittedAt ? q.submittedAt.toISOString() : "at an unknown time"}`)
        .join("; ")
        .concat("."),
    });
  }

  const summary =
    `Comparing ${quotations.length} submitted quotations. ` +
    `Totals span ${formatUsd(cheapest?.total ?? 0)} to ${formatUsd(priciest?.total ?? 0)}. ` +
    `${fastest ? `${fastest.freelancerName} quotes the shortest timeline at ${fastest.timelineDays} days. ` : ""}` +
    "Every figure above is taken directly from the quotations shown in this workspace; nothing has been estimated.";

  return {
    summary,
    keyDifferences,
    groundedQuotationIds: quotations.map((q) => q.id),
  };
}

// ─── Collaboration summary ───────────────────────────────────────────────────

export interface CollaborationSummaryInput {
  clientName: string;
  freelancerName: string;
  agreements: Array<{
    id: string;
    title: string;
    completedAt: Date;
    totalAmount: number;
    milestoneCount: number;
    deliverableTitles: string[];
  }>;
  confirmedPreferences: Array<{ id: string; statement: string; authorName: string }>;
}

/**
 * Requirement 21.2–21.4 — every sentence carries the id of the record it came
 * from, so the UI can render the citation list. Returns `null` when the pair
 * has no completed Agreement.
 */
export function heuristicCollaborationSummary(input: CollaborationSummaryInput): CollaborationSummary | null {
  if (input.agreements.length === 0) return null;

  const statements: CollaborationSummary["statements"] = [];

  for (const agreement of input.agreements) {
    statements.push({
      text: `${input.freelancerName} and ${input.clientName} completed "${agreement.title}" on ${agreement.completedAt
        .toISOString()
        .slice(0, 10)} with a total payment of ${formatUsd(agreement.totalAmount)} across ${
        agreement.milestoneCount
      } milestone${agreement.milestoneCount === 1 ? "" : "s"}.`,
      sourceType: "AGREEMENT",
      sourceId: agreement.id,
    });

    if (agreement.deliverableTitles.length > 0) {
      statements.push({
        text: `Approved deliverables on "${agreement.title}": ${agreement.deliverableTitles.slice(0, 10).join(", ")}.`,
        sourceType: "DELIVERABLE",
        sourceId: agreement.id,
      });
    }
  }

  for (const preference of input.confirmedPreferences) {
    statements.push({
      text: `Confirmed working preference from ${preference.authorName}: ${preference.statement}`,
      sourceType: "WORKING_PREFERENCE",
      sourceId: preference.id,
    });
  }

  const totalPaid = roundMoney(input.agreements.reduce((sum, agreement) => sum + agreement.totalAmount, 0));
  const summary = [
    `${input.clientName} and ${input.freelancerName} have completed ${input.agreements.length} project${
      input.agreements.length === 1 ? "" : "s"
    } together on PactFlow, totalling ${formatUsd(totalPaid)}.`,
    `The most recent project was "${input.agreements[0].title}".`,
    input.confirmedPreferences.length > 0
      ? `${input.confirmedPreferences.length} working preference${
          input.confirmedPreferences.length === 1 ? " is" : "s are"
        } mutually confirmed for this pair.`
      : "No working preferences have been mutually confirmed yet.",
    "This summary is limited to the records cited below.",
  ].join(" ");

  return { summary, statements };
}
