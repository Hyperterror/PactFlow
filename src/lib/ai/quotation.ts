import type { Brief, Quotation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { assertAcceptedInvitation } from "@/lib/access";
import { isRealLLMEnabled } from "@/lib/env";
import { AITimeoutError, AIValidationError, AI_TIMEOUTS, callLLMWithTimeout } from "@/lib/ai/client";
import { QuotationDraftSchema, type QuotationDraft } from "@/lib/ai/schemas";
import {
  heuristicQuotationDraft,
  type BriefGrounding,
  type HeuristicQuotationResult,
} from "@/lib/ai/heuristic";
import type { LineItem } from "@/lib/quotations";

/**
 * Requirement 4 — AI quotation draft generation.
 *
 * The AI produces a *recommendation* that is stored in `AI_DRAFT`. Nothing in
 * this module can move a Quotation to `SUBMITTED`; that requires the separate
 * `submitQuotation` call made by the Freelancer.
 */

/** Requirement 4.9 — a discarded draft may be regenerated at most 3 times. */
export const AI_MAX_REGENERATIONS = 3;

/** Requirement 4.8 — the form presented when generation cannot be grounded. */
export interface EmptyQuotationForm {
  lineItems: LineItem[];
  timelineDays: number;
  notes: string;
}

export function emptyQuotationForm(notice: string): EmptyQuotationForm {
  return {
    lineItems: [{ description: "", price: 0 }],
    timelineDays: 7,
    notes: notice,
  };
}

export const INSUFFICIENT_DETAIL_NOTICE =
  "The Brief lacks sufficient detail for AI generation. Please describe the work and the expected deliverables manually.";
export const TIMEOUT_NOTICE =
  "AI draft generation timed out after 30 seconds. A blank quotation form is provided instead — you can still submit a quotation manually.";
export const FAILURE_NOTICE =
  "AI draft generation failed. A blank quotation form is provided instead — you can still submit a quotation manually.";

export type AiDraftFailure = "TIMEOUT" | "VALIDATION" | "INSUFFICIENT_DETAIL" | "UNKNOWN";

export interface AiDraftOutcome {
  /** False when the caller must fall back to the empty form (Requirement 4.7/4.8). */
  generated: boolean;
  draft: QuotationDraft | null;
  form: EmptyQuotationForm;
  failure: AiDraftFailure | null;
  notice: string | null;
  /** True when at least one line item carries an "insufficient data" marker. */
  pricingInsufficientData: boolean;
  engine: "llm" | "heuristic";
  latencyMs: number;
}

const QUOTATION_SYSTEM_PROMPT = [
  "You are the PactFlow quotation assistant.",
  "You produce a structured quotation draft for a freelancer responding to a client brief.",
  "Ground every line item in the brief's deliverables and description. Never invent deliverables, stakeholders, or market data that the brief does not mention.",
  "Prices must be positive numbers in USD. Provide a price range, a confidence level (LOW, MEDIUM or HIGH) and a rationale for each line item.",
  "If the brief does not contain enough detail to price something, set insufficientData to true and give a LOW confidence instead of guessing.",
  "You never submit the quotation: a human freelancer reviews and submits it.",
].join(" ");

function buildQuotationPrompt(brief: BriefGrounding, historyAverageTotal: number | null): string {
  return [
    `Brief title: ${brief.title}`,
    `Brief description: ${brief.description}`,
    `Deliverables: ${brief.deliverables.join("; ")}`,
    `Budget range (USD): ${brief.budgetMin} to ${brief.budgetMax}`,
    `Target completion date: ${brief.targetDate ? brief.targetDate.toISOString() : "unspecified"}`,
    `Freelancer's average submitted quotation total on PactFlow: ${
      historyAverageTotal === null ? "no prior submitted quotations" : historyAverageTotal.toFixed(2)
    }`,
    'Respond with JSON: { "lineItems": [{ "description", "suggestedPrice", "pricingConfidence", "priceRangeMin", "priceRangeMax", "rationale", "marketBenchmarkSource", "insufficientData" }], "timelineDays", "notes", "briefReferences" }.',
  ].join("\n");
}

export interface GenerateQuotationDraftInput extends BriefGrounding {
  historyAverageTotal?: number | null;
}

/**
 * Generates a draft under a 30-second deadline (Requirement 4.2/4.7).
 *
 * The deterministic heuristic generator is used when no LLM credentials are
 * configured; when a remote call fails or exceeds the deadline, the caller
 * receives `generated: false` and the empty form, and the failure is recorded
 * by `requestAIDraft`.
 */
export async function generateQuotationDraft(
  input: GenerateQuotationDraftInput,
): Promise<AiDraftOutcome> {
  const startedAt = Date.now();
  const heuristic: HeuristicQuotationResult = heuristicQuotationDraft({
    ...input,
    historyAverageTotal: input.historyAverageTotal ?? null,
  });

  if (heuristic.insufficientDetail) {
    return {
      generated: false,
      draft: null,
      form: emptyQuotationForm(heuristic.draft.notes || INSUFFICIENT_DETAIL_NOTICE),
      failure: "INSUFFICIENT_DETAIL",
      notice: INSUFFICIENT_DETAIL_NOTICE,
      pricingInsufficientData: true,
      engine: isRealLLMEnabled() ? "llm" : "heuristic",
      latencyMs: Date.now() - startedAt,
    };
  }

  try {
    const draft = await callLLMWithTimeout<QuotationDraft>({
      label: "quotation-draft",
      system: QUOTATION_SYSTEM_PROMPT,
      prompt: buildQuotationPrompt(input, input.historyAverageTotal ?? null),
      schema: QuotationDraftSchema,
      timeoutMs: AI_TIMEOUTS.quotation,
      localFallback: () => heuristic.draft,
    });

    const pricingInsufficientData = draft.lineItems.some((item) => item.insufficientData === true);

    return {
      generated: true,
      draft,
      form: {
        lineItems: draftToLineItems(draft),
        timelineDays: draft.timelineDays,
        notes: draft.notes,
      },
      failure: null,
      notice: pricingInsufficientData
        ? "Insufficient data was available to price at least one line item. Set those prices manually."
        : null,
      pricingInsufficientData,
      engine: isRealLLMEnabled() ? "llm" : "heuristic",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const failure: AiDraftFailure =
      error instanceof AITimeoutError ? "TIMEOUT" : error instanceof AIValidationError ? "VALIDATION" : "UNKNOWN";
    const notice =
      failure === "TIMEOUT" ? TIMEOUT_NOTICE : failure === "VALIDATION" ? FAILURE_NOTICE : FAILURE_NOTICE;

    console.error("[ai] quotation draft generation failed", {
      failure,
      detail: error instanceof Error ? error.message : String(error),
    });

    return {
      generated: false,
      draft: null,
      form: emptyQuotationForm(notice),
      failure,
      notice,
      pricingInsufficientData: true,
      engine: isRealLLMEnabled() ? "llm" : "heuristic",
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Converts validated AI output into editable Quotation line items. */
export function draftToLineItems(draft: QuotationDraft): LineItem[] {
  return draft.lineItems.map((item) => ({
    description: item.description,
    price: item.suggestedPrice,
    pricingConfidence: item.pricingConfidence,
    priceRangeMin: item.priceRangeMin,
    priceRangeMax: item.priceRangeMax,
    rationale: item.rationale,
    marketBenchmarkSource: item.marketBenchmarkSource,
    insufficientData: item.insufficientData ?? false,
    aiSourced: false,
  }));
}

export interface RequestAIDraftOptions {
  /** True when the Freelancer is discarding the current draft and asking again. */
  regenerate?: boolean;
}

export interface RequestAIDraftResult {
  quotation: Quotation;
  outcome: AiDraftOutcome;
  regenerationCount: number;
  regenerationsRemaining: number;
}

/** Mean total of the Freelancer's previously submitted quotations (Requirement 5.2). */
export async function submittedQuotationAverage(freelancerId: string): Promise<number | null> {
  const prior = await prisma.quotation.findMany({
    where: { freelancerId, submittedAt: { not: null } },
    select: { lineItems: true },
  });
  const totals = prior
    .map((quotation) => asTotal(quotation.lineItems))
    .filter((total) => total > 0);
  if (totals.length === 0) return null;
  return totals.reduce((sum, total) => sum + total, 0) / totals.length;
}

function asTotal(lineItems: unknown): number {
  if (!Array.isArray(lineItems)) return 0;
  return lineItems.reduce((sum: number, item) => {
    if (item && typeof item === "object" && typeof (item as { price?: unknown }).price === "number") {
      return sum + (item as { price: number }).price;
    }
    return sum;
  }, 0);
}

/**
 * Requirement 4.1–4.9 — creates (or regenerates) the AI draft for a Brief.
 *
 * Regeneration never overwrites the discarded draft: the previous row is moved
 * to `WITHDRAWN` and a new `AI_DRAFT` row is created, so the full generation
 * history is preserved. The regeneration counter is capped at
 * `AI_MAX_REGENERATIONS` per Brief.
 */
export async function requestAIDraft(
  briefId: string,
  freelancerId: string,
  options: RequestAIDraftOptions = {},
): Promise<RequestAIDraftResult> {
  await assertAcceptedInvitation(briefId, freelancerId);

  const brief = await prisma.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");

  const existingDrafts = await prisma.quotation.findMany({
    where: { briefId, freelancerId, status: "AI_DRAFT" },
    orderBy: { createdAt: "desc" },
  });

  if (!options.regenerate && existingDrafts.length > 0) {
    const current = existingDrafts[0];
    return {
      quotation: current,
      outcome: {
        generated: true,
        draft: null,
        form: {
          lineItems: (current.lineItems as unknown as LineItem[]) ?? [],
          timelineDays: current.timelineDays,
          notes: current.notes,
        },
        failure: null,
        notice: "An existing AI draft was found and returned without consuming a regeneration attempt.",
        pricingInsufficientData: false,
        engine: "heuristic",
        latencyMs: 0,
      },
      regenerationCount: current.regenerationCount,
      regenerationsRemaining: Math.max(0, AI_MAX_REGENERATIONS - current.regenerationCount),
    };
  }

  if (options.regenerate && existingDrafts.length === 0) {
    throw new ConflictError(
      "AI_DRAFT_NOT_FOUND",
      "There is no AI draft to regenerate. Request a new draft instead.",
    );
  }

  const previous = existingDrafts[0] ?? null;
  const nextRegenerationCount = previous ? previous.regenerationCount + 1 : 0;

  if (options.regenerate && nextRegenerationCount > AI_MAX_REGENERATIONS) {
    throw new ConflictError(
      "AI_REGENERATION_LIMIT",
      `This Brief has reached the maximum of ${AI_MAX_REGENERATIONS} AI regeneration attempts. Edit the current draft or price the quotation manually.`,
      String(previous?.regenerationCount ?? AI_MAX_REGENERATIONS),
    );
  }

  const historyAverageTotal = await submittedQuotationAverage(freelancerId);

  const outcome = await generateQuotationDraft({
    title: brief.title,
    description: brief.description,
    deliverables: Array.isArray(brief.deliverables)
      ? (brief.deliverables as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
    budgetMin: Number(brief.budgetMin),
    budgetMax: Number(brief.budgetMax),
    targetDate: brief.targetDate ?? null,
    historyAverageTotal,
  });

  const snapshot = {
    engine: outcome.engine,
    generatedAt: new Date().toISOString(),
    latencyMs: outcome.latencyMs,
    failure: outcome.failure,
    notice: outcome.notice,
    draft: outcome.draft,
    form: outcome.form,
  };

  const created = await withTransaction(async (tx) => {
    if (previous) {
      // Requirement 4.9 — the discarded draft is preserved, never overwritten.
      await tx.quotation.update({
        where: { id: previous.id },
        data: { status: "WITHDRAWN" },
      });
      await writeAuditLog(tx, {
        eventType: "QUOTATION_WITHDRAWN",
        actorId: freelancerId,
        resourceId: previous.id,
        resourceType: "Quotation",
        previousState: previous.status,
        newState: "WITHDRAWN",
        metadata: { reason: "AI_DRAFT_DISCARDED", briefId },
      });
    }

    const quotation = await tx.quotation.create({
      data: {
        briefId,
        freelancerId,
        status: outcome.generated ? "AI_DRAFT" : "DRAFT",
        lineItems: outcome.form.lineItems as object,
        timelineDays: outcome.form.timelineDays,
        notes: outcome.form.notes,
        aiDraftSnapshot: snapshot as object,
        regenerationCount: nextRegenerationCount,
      },
    });

    if (outcome.generated) {
      await writeAuditLog(tx, {
        eventType: nextRegenerationCount > 0 ? "QUOTATION_REGENERATED" : "QUOTATION_AI_DRAFT_CREATED",
        actorId: freelancerId,
        resourceId: quotation.id,
        resourceType: "Quotation",
        previousState: null,
        newState: quotation.status,
        metadata: {
          briefId,
          engine: outcome.engine,
          latencyMs: outcome.latencyMs,
          regenerationCount: nextRegenerationCount,
        },
      });
    } else {
      // Requirement 4.7/4.8 — the generation failure is logged.
      await writeAuditLog(tx, {
        eventType: "AI_GENERATION_FAILED",
        actorId: freelancerId,
        resourceId: quotation.id,
        resourceType: "Quotation",
        previousState: null,
        newState: quotation.status,
        metadata: {
          briefId,
          failure: outcome.failure,
          notice: outcome.notice,
          latencyMs: outcome.latencyMs,
        },
      });
    }

    return quotation;
  });

  return {
    quotation: created,
    outcome,
    regenerationCount: nextRegenerationCount,
    regenerationsRemaining: Math.max(0, AI_MAX_REGENERATIONS - nextRegenerationCount),
  };
}

/** Convenience wrapper used by the Brief detail page to show readiness. */
export async function quotationDraftState(
  briefId: string,
  freelancerId: string,
): Promise<{ hasDraft: boolean; regenerationCount: number; remaining: number }> {
  const draft = await prisma.quotation.findFirst({
    where: { briefId, freelancerId, status: "AI_DRAFT" },
    orderBy: { createdAt: "desc" },
    select: { regenerationCount: true },
  });
  return {
    hasDraft: Boolean(draft),
    regenerationCount: draft?.regenerationCount ?? 0,
    remaining: Math.max(0, AI_MAX_REGENERATIONS - (draft?.regenerationCount ?? 0)),
  };
}

/** Type guard used by tests and the UI layer. */
export function isAiDraft(quotation: Pick<Quotation, "status">): boolean {
  return quotation.status === "AI_DRAFT";
}

export type { Brief };
