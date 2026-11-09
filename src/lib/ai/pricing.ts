import type { Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertOwnedByFreelancer, assertEditable, type LineItem } from "@/lib/quotations";
import { submittedQuotationAverage } from "@/lib/ai/quotation";
import {
  BASELINE_RATE_CARD_SOURCE,
  heuristicPricingRecommendation,
  type HeuristicPricingInput,
} from "@/lib/ai/heuristic";
import type { PricingRecommendation } from "@/lib/ai/schemas";

/**
 * Requirement 5 — pricing intelligence.
 *
 * The recommendation is metadata attached to a line item. It never overwrites
 * the Freelancer's `price` (Requirement 5.4): the Freelancer either accepts it
 * unchanged (recorded as `aiSourced` by `saveAuditedEdit`) or types their own
 * figure.
 */

export const INSUFFICIENT_DATA_LABEL = "Insufficient data";

export interface PricingRecommendationView extends PricingRecommendation {
  lineItemIndex: number;
  description: string;
  dismissed: boolean;
  label: string | null;
}

export interface LineItemView {
  lineItemIndex: number;
  description: string;
  price: number;
  recommendation: PricingRecommendationView | null;
}

function dismissedIndexes(quotation: Quotation): number[] {
  const raw = quotation.dismissedPricing;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is number => typeof value === "number");
}

function readLineItems(quotation: Quotation): LineItem[] {
  const raw = quotation.lineItems;
  if (!Array.isArray(raw)) return [];
  return raw as unknown as LineItem[];
}

/** Rebuilds a recommendation from the metadata already stored on a line item. */
function storedRecommendation(item: LineItem): PricingRecommendation | null {
  if (!item.pricingConfidence || !item.rationale) return null;
  const min = typeof item.priceRangeMin === "number" ? item.priceRangeMin : undefined;
  const max = typeof item.priceRangeMax === "number" ? item.priceRangeMax : undefined;
  return {
    recommendedPrice: typeof item.price === "number" ? item.price : undefined,
    priceRangeMin: min,
    priceRangeMax: max,
    pricingConfidence: item.pricingConfidence,
    rationale: item.rationale,
    basis: !item.marketBenchmarkSource
      ? "BRIEF_BUDGET"
      : item.marketBenchmarkSource === BASELINE_RATE_CARD_SOURCE
        ? "BASELINE_ESTIMATE"
        : "MARKET_BENCHMARK",
    marketBenchmarkSource: item.marketBenchmarkSource,
    insufficientData: item.insufficientData === true,
  };
}

export interface RecommendPricingOptions {
  /** Brief budget range used as the primary anchor (Requirement 5.2). */
  briefBudgetMin?: number | null;
  briefBudgetMax?: number | null;
  /** Skip the persistence step; used by the read-only quotation editor view. */
  persist?: boolean;
}

/**
 * Requirement 5.1–5.7 — one recommendation per non-dismissed line item.
 *
 * Dismissed recommendations are skipped entirely so they are never "restored
 * automatically" (Requirement 5.8); their stored dismissal is respected on
 * every subsequent call.
 */
export async function recommendPricingForQuotation(
  quotationId: string,
  freelancerId: string,
  options: RecommendPricingOptions = {},
): Promise<PricingRecommendationView[]> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new NotFoundError("Quotation");
  assertOwnedByFreelancer(quotation, freelancerId);
  assertEditable(quotation);

  const items = readLineItems(quotation);
  const dismissed = new Set(dismissedIndexes(quotation));
  const historyAverageTotal = await submittedQuotationAverage(freelancerId);

  const views: PricingRecommendationView[] = items.map((item, index) => {
    const description = item.description ?? "";
    if (dismissed.has(index)) {
      const stored = storedRecommendation(item);
      return {
        lineItemIndex: index,
        description,
        dismissed: true,
        label: null,
        ...(stored ?? {
          pricingConfidence: "LOW" as const,
          rationale: "This recommendation was dismissed by the Freelancer and is not restored automatically.",
          basis: "BRIEF_BUDGET" as const,
          insufficientData: true,
        }),
      };
    }

    const input: HeuristicPricingInput = {
      description,
      briefBudgetMin: options.briefBudgetMin ?? null,
      briefBudgetMax: options.briefBudgetMax ?? null,
      historyAverageTotal,
    };
    const recommendation = heuristicPricingRecommendation(input);
    return {
      lineItemIndex: index,
      description,
      dismissed: false,
      label: recommendation.insufficientData ? INSUFFICIENT_DATA_LABEL : null,
      ...recommendation,
    };
  });

  const shouldPersist = options.persist !== false && items.length > 0;
  if (!shouldPersist) return views;

  const merged = items.map((item, index) => {
    const view = views[index];
    if (!view || view.dismissed) return item;
    // Only metadata is written — `price` is untouched (Requirement 5.4).
    return {
      ...item,
      pricingConfidence: view.pricingConfidence,
      priceRangeMin: view.priceRangeMin,
      priceRangeMax: view.priceRangeMax,
      rationale: view.rationale,
      marketBenchmarkSource: view.marketBenchmarkSource,
      insufficientData: view.insufficientData,
    } satisfies LineItem;
  });

  await withTransaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotationId },
      data: { lineItems: merged as object },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_UPDATED",
      actorId: freelancerId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: quotation.status,
      metadata: {
        pricingRecommendations: views
          .filter((view) => !view.dismissed)
          .map((view) => ({
            lineItemIndex: view.lineItemIndex,
            approach: view.basis,
            pricingConfidence: view.pricingConfidence,
            insufficientData: view.insufficientData,
          })),
      },
    });
  });

  return views;
}

/**
 * Requirement 5.3 — the editor needs the recommendation next to each editable
 * price field without mutating anything.
 */
export async function pricingEditorView(
  quotationId: string,
  freelancerId: string,
  briefBudget: { min: number; max: number },
): Promise<LineItemView[]> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new NotFoundError("Quotation");
  assertOwnedByFreelancer(quotation, freelancerId);

  const items = readLineItems(quotation);
  const views = await recommendPricingForQuotation(quotationId, freelancerId, {
    briefBudgetMin: briefBudget.min,
    briefBudgetMax: briefBudget.max,
    persist: false,
  });

  return items.map((item, index) => {
    const view = views[index] ?? null;
    return {
      lineItemIndex: index,
      description: item.description ?? "",
      price: typeof item.price === "number" ? item.price : 0,
      recommendation: view,
    };
  });
}

/**
 * Requirement 5.5 — records which line items were accepted verbatim from the
 * AI recommendation. Called after an edit is saved so the audit trail shows the
 * Freelancer explicitly confirmed the AI figure.
 */
export async function markAiSourced(
  quotationId: string,
  freelancerId: string,
  indexes: number[],
): Promise<Quotation> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quotation) throw new NotFoundError("Quotation");
  assertOwnedByFreelancer(quotation, freelancerId);
  assertEditable(quotation);

  const items = readLineItems(quotation);
  const accepted = new Set(indexes.filter((index) => index >= 0 && index < items.length));
  if (accepted.size === 0) return quotation;

  const merged = items.map((item, index) =>
    accepted.has(index) ? { ...item, aiSourced: true } : item,
  );

  return withTransaction(async (tx) => {
    const updated = await tx.quotation.update({
      where: { id: quotationId },
      data: {
        lineItems: merged as object,
        aiSourcedFields: [...accepted].sort((a, b) => a - b),
      },
    });
    await writeAuditLog(tx, {
      eventType: "QUOTATION_UPDATED",
      actorId: freelancerId,
      resourceId: quotationId,
      resourceType: "Quotation",
      previousState: quotation.status,
      newState: updated.status,
      metadata: { aiSourcedLineItems: [...accepted].sort((a, b) => a - b) },
    });
    return updated;
  });
}

/** Guard used by the dismissal endpoint so the badge cannot be restored. */
export function assertNotDismissed(quotation: Quotation, lineItemIndex: number): void {
  if (dismissedIndexes(quotation).includes(lineItemIndex)) {
    throw new ConflictError(
      "PRICING_RECOMMENDATION_DISMISSED",
      "This pricing recommendation was dismissed and is not restored automatically.",
      quotation.status,
    );
  }
}
