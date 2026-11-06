import type { ChangeRequest } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { AITimeoutError, AIValidationError, AI_TIMEOUTS, callLLMWithTimeout } from "@/lib/ai/client";
import { ScopeClassificationSchema, type ScopeClassification } from "@/lib/ai/schemas";
import { heuristicScopeClassification } from "@/lib/ai/heuristic";
import { isRealLLMEnabled } from "@/lib/env";

/**
 * Requirement 11 — AI scope-change detection.
 *
 * The classifier writes only `scopeLabel`, `scopeRationale` and
 * `scopeClassifiedAt`. It never touches `status` or the votes: the AI cannot
 * approve or reject a Change_Request (Requirement 11.4).
 */

export const CLASSIFICATION_TIMEOUT_MS = AI_TIMEOUTS.scopeClassification;
export const AMBIGUOUS_FALLBACK_RATIONALE =
  "The AI scope classification did not complete within 20 seconds, so this change is marked AMBIGUOUS by default. Both parties must review the proposal manually before voting.";

const SCOPE_SYSTEM_PROMPT = [
  "You classify a proposed project change against the scope recorded in an active freelance agreement.",
  "Return exactly one label: INCLUDED (the change is already covered by the agreed scope), OUTSIDE_SCOPE (the change is clearly beyond the agreed scope), or AMBIGUOUS (the boundary needs human clarification).",
  "Your rationale must be 50 to 1000 characters, cite the agreed scope terms you relied on, and must not recommend a vote outcome.",
].join(" ");

function activeScopeText(content: unknown): string {
  if (content === null || content === undefined) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export interface ClassifyChangeRequestResult {
  changeRequest: ChangeRequest;
  classification: ScopeClassification;
  /** True when the AMBIGUOUS default was written because the AI did not finish. */
  timedOut: boolean;
  engine: "llm" | "heuristic";
  latencyMs: number;
}

/**
 * Requirement 11.1/11.2/11.5 — classifies within 20 seconds, defaulting to
 * AMBIGUOUS and notifying both parties when the deadline is missed.
 */
export async function classifyChangeRequest(
  changeRequestId: string,
  options: { engine?: "llm" | "heuristic" } = {},
): Promise<ClassifyChangeRequestResult> {
  const startedAt = Date.now();
  const changeRequest = await prisma.changeRequest.findUnique({
    where: { id: changeRequestId },
    include: {
      agreement: { include: { versions: true } },
      discussionMessage: true,
    },
  });
  if (!changeRequest) throw new NotFoundError("ChangeRequest");

  const activeVersion =
    changeRequest.agreement.versions.find(
      (version) => version.versionNumber === changeRequest.agreement.currentVersion,
    ) ?? null;

  const scopeText = activeScopeText(activeVersion?.content);
  const proposalText = changeRequest.discussionMessage?.content ?? "";

  const heuristic = heuristicScopeClassification({
    proposalText,
    activeScopeText: scopeText,
  });

  let classification: ScopeClassification = heuristic;
  let timedOut = false;

  try {
    classification = await callLLMWithTimeout<ScopeClassification>({
      label: "scope-classification",
      system: SCOPE_SYSTEM_PROMPT,
      prompt: [
        `Active Agreement version: ${changeRequest.agreement.currentVersion}`,
        `Agreed scope content: ${scopeText.slice(0, 6000)}`,
        `Proposed change: ${proposalText.slice(0, 4000)}`,
        'Respond with JSON: { "label": "INCLUDED" | "OUTSIDE_SCOPE" | "AMBIGUOUS", "rationale": "..." }.',
      ].join("\n"),
      schema: ScopeClassificationSchema,
      timeoutMs: CLASSIFICATION_TIMEOUT_MS,
      localFallback: () => heuristic,
    });
  } catch (error) {
    const isTimeout = error instanceof AITimeoutError;
    const isValidation = error instanceof AIValidationError;
    timedOut = isTimeout;
    classification = {
      label: "AMBIGUOUS",
      rationale: isTimeout
        ? AMBIGUOUS_FALLBACK_RATIONALE
        : `The AI scope classification could not be completed (${isValidation ? "invalid AI response" : "internal failure"}), so this change is marked AMBIGUOUS by default. Both parties must review the proposal manually before voting.`,
    };
    console.error("[ai] scope classification failed", {
      changeRequestId,
      reason: isTimeout ? "TIMEOUT" : isValidation ? "VALIDATION" : "UNKNOWN",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const latencyMs = Date.now() - startedAt;
  const engine: "llm" | "heuristic" = options.engine ?? (isRealLLMEnabled() ? "llm" : "heuristic");

  const updated = await withTransaction(async (tx) => {
    const written = await tx.changeRequest.update({
      where: { id: changeRequestId },
      data: {
        scopeLabel: classification.label,
        scopeRationale: classification.rationale,
        scopeClassifiedAt: new Date(),
      },
    });

    await writeAuditLog(tx, {
      eventType: "CHANGE_REQUEST_CLASSIFIED",
      actorId: changeRequest.submitterId,
      resourceId: changeRequestId,
      resourceType: "ChangeRequest",
      previousState: changeRequest.scopeLabel ?? null,
      newState: classification.label,
      metadata: {
        agreementId: changeRequest.agreementId,
        engine,
        timedOut,
        latencyMs,
        rationale: classification.rationale,
      },
    });

    if (timedOut) {
      await writeAuditLog(tx, {
        eventType: "AI_GENERATION_FAILED",
        actorId: changeRequest.submitterId,
        resourceId: changeRequestId,
        resourceType: "ChangeRequest",
        previousState: null,
        newState: "AMBIGUOUS",
        metadata: { reason: "SCOPE_CLASSIFICATION_TIMEOUT", timeoutMs: CLASSIFICATION_TIMEOUT_MS },
      });
    }

    // Requirement 11.5 — both parties are told manual review is required.
    const recipients = [changeRequest.agreement.clientId, changeRequest.agreement.freelancerId];
    for (const userId of recipients) {
      await tx.notification.create({
        data: {
          userId,
          type: timedOut ? "SCOPE_CLASSIFICATION_FAILED" : "CHANGE_REQUEST_CLASSIFIED",
          payload: {
            changeRequestId,
            agreementId: changeRequest.agreementId,
            scopeLabel: classification.label,
            manualReviewRequired: timedOut,
          } as object,
          guaranteed: false,
        },
      });
    }

    return written;
  });

  return { changeRequest: updated, classification, timedOut, engine, latencyMs };
}

/**
 * Requirement 11.6 — dispute justification bounds. The dispute is stored next
 * to the original label; the label itself is never altered.
 */
export const DISPUTE_MIN_LENGTH = 10;
export const DISPUTE_MAX_LENGTH = 2000;

export function validateDisputeJustification(justification: string): string[] {
  const trimmed = justification.trim();
  const issues: string[] = [];
  if (trimmed.length < DISPUTE_MIN_LENGTH) {
    issues.push(`Justification must be at least ${DISPUTE_MIN_LENGTH} characters.`);
  }
  if (trimmed.length > DISPUTE_MAX_LENGTH) {
    issues.push(`Justification must be at most ${DISPUTE_MAX_LENGTH} characters.`);
  }
  return issues;
}
