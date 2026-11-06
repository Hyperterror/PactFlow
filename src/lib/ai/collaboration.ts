import { AITimeoutError, AIValidationError, AI_TIMEOUTS, callLLMWithTimeout } from "@/lib/ai/client";
import { CollaborationSummarySchema, type CollaborationSummary } from "@/lib/ai/schemas";
import {
  formatUsd,
  heuristicCollaborationSummary,
  type CollaborationSummaryInput,
} from "@/lib/ai/heuristic";
import { isRealLLMEnabled } from "@/lib/env";

/**
 * Requirement 21 — AI collaboration summaries.
 *
 * Grounding rule: every statement carries the id of the Collaboration_History
 * record it came from, and statements citing an unknown id are dropped. If no
 * grounded statement survives, the deterministic grounded summary is used
 * instead so the citation list is always complete.
 */

export const INSUFFICIENT_HISTORY_NOTICE = "Insufficient collaboration history to generate a summary";

export interface CollaborationSummaryOutcome {
  available: boolean;
  summary: CollaborationSummary | null;
  notice: string | null;
  engine: "llm" | "heuristic";
  latencyMs: number;
}

const COLLABORATION_SYSTEM_PROMPT = [
  "You summarise a completed freelance collaboration for a repeat engagement.",
  "Ground every statement exclusively in the records supplied: completed agreements, approved deliverables and mutually confirmed working preferences.",
  "Attach the exact sourceType and sourceId of the record each statement came from. Never mention anything that is not in the supplied records.",
  "Do not speculate about quality, reliability or future behaviour.",
].join(" ");

function buildPrompt(input: CollaborationSummaryInput): string {
  return [
    `Client: ${input.clientName}`,
    `Freelancer: ${input.freelancerName}`,
    "Completed agreements:",
    JSON.stringify(
      input.agreements.map((agreement) => ({
        id: agreement.id,
        title: agreement.title,
        completedAt: agreement.completedAt.toISOString(),
        totalAmount: formatUsd(agreement.totalAmount),
        milestoneCount: agreement.milestoneCount,
        deliverableTitles: agreement.deliverableTitles,
      })),
      null,
      2,
    ),
    "Confirmed working preferences:",
    JSON.stringify(input.confirmedPreferences, null, 2),
    'Respond with JSON: { "summary": "...", "statements": [{ "text": "...", "sourceType": "AGREEMENT" | "DELIVERABLE" | "WORKING_PREFERENCE", "sourceId": "..." }] }.',
  ].join("\n");
}

export async function generateCollaborationSummary(
  input: CollaborationSummaryInput,
): Promise<CollaborationSummaryOutcome> {
  const startedAt = Date.now();
  const engine: "llm" | "heuristic" = isRealLLMEnabled() ? "llm" : "heuristic";

  // Requirement 21.4 — no completed Agreement means no summary at all.
  if (input.agreements.length === 0) {
    return {
      available: false,
      summary: null,
      notice: INSUFFICIENT_HISTORY_NOTICE,
      engine,
      latencyMs: 0,
    };
  }

  const fallback = heuristicCollaborationSummary(input);
  const knownIds = new Set<string>([
    ...input.agreements.map((agreement) => agreement.id),
    ...input.confirmedPreferences.map((preference) => preference.id),
  ]);

  try {
    const summary = await callLLMWithTimeout<CollaborationSummary>({
      label: "collaboration-summary",
      system: COLLABORATION_SYSTEM_PROMPT,
      prompt: buildPrompt(input),
      schema: CollaborationSummarySchema,
      timeoutMs: AI_TIMEOUTS.summary,
      localFallback: () => fallback ?? { summary: INSUFFICIENT_HISTORY_NOTICE, statements: [] },
    });

    const grounded = summary.statements.filter((statement) => knownIds.has(statement.sourceId));
    if (grounded.length === 0) {
      return {
        available: fallback !== null,
        summary: fallback,
        notice: fallback === null ? INSUFFICIENT_HISTORY_NOTICE : null,
        engine,
        latencyMs: Date.now() - startedAt,
      };
    }

    return {
      available: true,
      summary: { ...summary, statements: grounded },
      notice: null,
      engine,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error("[ai] collaboration summary failed", {
      reason:
        error instanceof AITimeoutError
          ? "TIMEOUT"
          : error instanceof AIValidationError
            ? "VALIDATION"
            : "UNKNOWN",
      detail: error instanceof Error ? error.message : String(error),
    });
    // Requirement 21.1/21.3 — the grounded deterministic summary still ships
    // with a complete citation list rather than failing outright.
    return {
      available: fallback !== null,
      summary: fallback,
      notice: fallback === null ? INSUFFICIENT_HISTORY_NOTICE : "AI summary regenerated from stored records only.",
      engine,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * Requirement 21.5 — flagging records the flag but never alters the underlying
 * history. Returned shape is persisted verbatim in
 * `CollaborationSummary.flaggedStatements`.
 */
export interface FlaggedStatement {
  statementIndex: number;
  flaggedByUserId: string;
  flaggedAt: string;
  reason?: string;
}

export function addFlag(
  existing: unknown,
  flag: FlaggedStatement,
): { flags: FlaggedStatement[]; duplicate: boolean } {
  const current = Array.isArray(existing)
    ? existing.filter(
        (value): value is FlaggedStatement =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as FlaggedStatement).statementIndex === "number" &&
          typeof (value as FlaggedStatement).flaggedByUserId === "string",
      )
    : [];

  const duplicate = current.some(
    (value) =>
      value.statementIndex === flag.statementIndex && value.flaggedByUserId === flag.flaggedByUserId,
  );
  if (duplicate) return { flags: current, duplicate: true };

  return { flags: [...current, flag], duplicate: false };
}

export type { CollaborationSummaryInput, CollaborationSummary };
