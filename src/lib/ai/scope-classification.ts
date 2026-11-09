import type { ChangeRequest } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withTransaction, writeAuditLog } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import { AITimeoutError, AIValidationError, AI_TIMEOUTS, callLLMWithTimeout } from "@/lib/ai/client";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ScopeClassificationSchema, type ScopeClassification } from "@/lib/ai/schemas";
import { isRealLLMEnabled } from "@/lib/env";
import {
  buildScopeBaseline,
  classifyAgainstBaseline,
  enforceEvidence,
  ScopeEvidenceSchema,
  type EvidencedClassification,
  type ScopeBaseline,
} from "@/lib/ai/scope-baseline";

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
  "You classify a proposed project change against the agreed scope baseline: the mutually approved requirements brief and the active SOW.",
  "Return exactly one label: INCLUDED (already covered by the agreed scope), OUTSIDE_SCOPE (clearly beyond it, or matching an explicit exclusion), or AMBIGUOUS (the boundary needs human clarification).",
  "Cite the baseline items you relied on in `evidence` by their exact ref (e.g. REQ-002, OOS-001, DEL-001), with relation COVERED_BY, EXCLUDED_BY, PARTIALLY_COVERED_BY or NEAREST_TERM. A label without evidence is not accepted.",
  "Your rationale must be 50 to 1000 characters and must not recommend a vote outcome.",
].join(" ");

type LlmClassification = ScopeClassification & { evidence: EvidencedClassification["evidence"] };

const EvidencedClassificationSchema = ScopeClassificationSchema.extend({
  evidence: z.array(ScopeEvidenceSchema).max(10).default([]),
});

function baselinePrompt(baseline: ScopeBaseline): string {
  return baseline.items.map((item) => `- [${item.ref}] (${item.kind}, ${item.source}) ${item.text}`).join("\n");
}

/** The active agreement version plus the approved requirements version behind it. */
async function loadBaseline(agreementId: string, currentVersion: number): Promise<ScopeBaseline> {
  const versions = await prisma.agreementVersion.findMany({
    where: { agreementId },
    orderBy: { versionNumber: "desc" },
  });
  const active = versions.find((version) => version.versionNumber === currentVersion) ?? versions[0] ?? null;
  const requirementsVersionId =
    active?.requirementsVersionId ??
    versions.find((version) => version.requirementsVersionId)?.requirementsVersionId ??
    null;
  const requirements = requirementsVersionId
    ? await prisma.requirementsVersion.findUnique({ where: { id: requirementsVersionId } })
    : null;
  return buildScopeBaseline({
    agreementVersionNumber: active?.versionNumber ?? currentVersion,
    agreementContent: active?.content ?? null,
    requirements: requirements ? { versionNumber: requirements.versionNumber, content: requirements.content } : null,
  });
}

export interface ClassifyChangeRequestResult {
  changeRequest: ChangeRequest;
  classification: EvidencedClassification;
  /** What the change was judged against, e.g. "Requirements v3 + Agreement v1 (SOW)". */
  baseline: string;
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
      agreement: true,
      discussionMessage: true,
    },
  });
  if (!changeRequest) throw new NotFoundError("ChangeRequest");

  const baseline = await loadBaseline(changeRequest.agreementId, changeRequest.agreement.currentVersion);
  const proposalText = changeRequest.discussionMessage?.content ?? "";
  const heuristic = classifyAgainstBaseline(proposalText, baseline);

  let classification: EvidencedClassification = heuristic;
  let timedOut = false;

  try {
    const raw = await callLLMWithTimeout<LlmClassification>({
      label: "scope-classification",
      system: SCOPE_SYSTEM_PROMPT,
      prompt: [
        `Scope baseline: ${baseline.label}`,
        "Baseline items:",
        baselinePrompt(baseline).slice(0, 8000),
        `Proposed change: ${proposalText.slice(0, 4000)}`,
        'Respond with JSON: { "label": "INCLUDED" | "OUTSIDE_SCOPE" | "AMBIGUOUS", "rationale": "...", "evidence": [{ "ref": "REQ-001", "relation": "COVERED_BY", "matchedTerms": ["..."] }] }.',
      ].join("\n"),
      schema: EvidencedClassificationSchema as unknown as z.ZodType<LlmClassification>,
      timeoutMs: CLASSIFICATION_TIMEOUT_MS,
      localFallback: () => heuristic,
    });
    // Evidence must point at real baseline items; a decisive label without any is downgraded.
    classification = enforceEvidence(raw, baseline);
  } catch (error) {
    const isTimeout = error instanceof AITimeoutError;
    const isValidation = error instanceof AIValidationError;
    timedOut = isTimeout;
    classification = {
      evidence: [],
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
        scopeEvidence: classification.evidence as unknown as Prisma.InputJsonValue,
        scopeBaseline: baseline.label,
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
        baseline: baseline.label,
        evidence: classification.evidence.map((entry) => `${entry.relation}:${entry.ref}`),
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

  return { changeRequest: updated, classification, baseline: baseline.label, timedOut, engine, latencyMs };
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
