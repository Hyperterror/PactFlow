import { AITimeoutError, AIValidationError, AI_TIMEOUTS, callLLMWithTimeout } from "@/lib/ai/client";
import { ComparisonSummarySchema, type ComparisonSummary } from "@/lib/ai/schemas";
import {
  heuristicComparisonSummary,
  formatUsd,
  type ComparisonQuotationLike,
} from "@/lib/ai/heuristic";
import { isRealLLMEnabled } from "@/lib/env";

/**
 * Requirement 8.4–8.6 — AI comparison assistance.
 *
 * All statements must be derivable from the quotations passed in. When the call
 * times out or returns something that does not validate, the caller receives
 * `available: false` and the UI must show "AI comparison unavailable — please
 * compare manually" while keeping every column rendered.
 */

export const AI_COMPARISON_UNAVAILABLE = "AI comparison unavailable — please compare manually";

export interface ComparisonQuotationInput extends ComparisonQuotationLike {
  lineItems: Array<{ description: string; price: number }>;
  notes: string;
}

export interface ComparisonSummaryOutcome {
  available: boolean;
  summary: ComparisonSummary | null;
  notice: string | null;
  engine: "llm" | "heuristic";
  latencyMs: number;
}

const COMPARISON_SYSTEM_PROMPT = [
  "You compare freelance quotations.",
  "Every comparative statement must be derivable from the quotation data supplied in the prompt: totals, timelines, line items, notes and submission timestamps.",
  "Never invent a quotation, a price, a deliverable or a market fact. If data is missing for an attribute, say it is not stated.",
  "List the ids of the quotations you referenced in groundedQuotationIds.",
].join(" ");

function buildPrompt(quotations: ComparisonQuotationInput[]): string {
  const rows = quotations.map((quotation) => ({
    id: quotation.id,
    freelancer: quotation.freelancerName,
    total: formatUsd(quotation.total),
    timelineDays: quotation.timelineDays,
    submittedAt: quotation.submittedAt ? quotation.submittedAt.toISOString() : null,
    lineItems: quotation.lineItems,
    notes: quotation.notes.slice(0, 1500),
  }));
  return [
    "Quotations to compare:",
    JSON.stringify(rows, null, 2),
    'Respond with JSON: { "summary": "...", "keyDifferences": [{ "attribute": "...", "comparison": "..." }], "groundedQuotationIds": ["..."] }.',
  ].join("\n");
}

export async function generateComparisonSummary(
  quotations: ComparisonQuotationInput[],
): Promise<ComparisonSummaryOutcome> {
  const startedAt = Date.now();
  if (quotations.length < 2) {
    return {
      available: false,
      summary: null,
      notice: "Select at least two quotations to request an AI comparison.",
      engine: isRealLLMEnabled() ? "llm" : "heuristic",
      latencyMs: 0,
    };
  }

  const fallback = heuristicComparisonSummary(quotations);

  try {
    const summary = await callLLMWithTimeout<ComparisonSummary>({
      label: "comparison-summary",
      system: COMPARISON_SYSTEM_PROMPT,
      prompt: buildPrompt(quotations),
      schema: ComparisonSummarySchema,
      timeoutMs: AI_TIMEOUTS.comparison,
      localFallback: () => fallback,
    });

    // Requirement 8.5 — reject any answer that cites a quotation we did not supply.
    const known = new Set(quotations.map((quotation) => quotation.id));
    const grounded = summary.groundedQuotationIds.filter((id) => known.has(id));
    if (grounded.length === 0) {
      return {
        available: false,
        summary: fallback,
        notice: AI_COMPARISON_UNAVAILABLE,
        engine: isRealLLMEnabled() ? "llm" : "heuristic",
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      available: true,
      summary: { ...summary, groundedQuotationIds: grounded },
      notice: null,
      engine: isRealLLMEnabled() ? "llm" : "heuristic",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("[ai] comparison summary failed", {
      reason:
        error instanceof AITimeoutError
          ? "TIMEOUT"
          : error instanceof AIValidationError
            ? "VALIDATION"
            : "UNKNOWN",
      detail: error instanceof Error ? error.message : String(error),
    });
    return {
      available: false,
      summary: null,
      notice: AI_COMPARISON_UNAVAILABLE,
      engine: isRealLLMEnabled() ? "llm" : "heuristic",
      latencyMs: Date.now() - startedAt,
    };
  }
}
