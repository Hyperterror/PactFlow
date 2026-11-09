import { z } from "zod";
import { tokenize } from "@/lib/ai/heuristic";
import { parseStoredContent, type RequirementsContent } from "@/lib/requirements/content";

/**
 * The scope baseline a change request is judged against (Lifecycle Update PRD
 * FR-07): the mutually approved requirements brief plus the active SOW, broken
 * into items with stable IDs so every classification can cite exactly what it
 * relied on. A label without evidence is not accepted.
 *
 * Legacy agreements (created before the requirements stage) have no BRD; their
 * baseline falls back to the agreement's own deliverables and description.
 */

export type BaselineKind = "REQUIREMENT" | "QUALITY" | "DELIVERABLE" | "ASSUMPTION" | "CONSTRAINT" | "OUT_OF_SCOPE";

export interface BaselineItem {
  ref: string;
  kind: BaselineKind;
  text: string;
  source: string;
}

export interface ScopeBaseline {
  label: string;
  items: BaselineItem[];
}

export const EVIDENCE_RELATIONS = ["COVERED_BY", "EXCLUDED_BY", "PARTIALLY_COVERED_BY", "NEAREST_TERM"] as const;

export const ScopeEvidenceSchema = z.object({
  ref: z.string().min(1).max(40),
  relation: z.enum(EVIDENCE_RELATIONS),
  text: z.string().max(500).default(""),
  matchedTerms: z.array(z.string().max(60)).max(10).default([]),
});
export type ScopeEvidence = z.infer<typeof ScopeEvidenceSchema>;

/** Reads stored evidence JSON back; anything malformed is dropped rather than shown. */
export function readStoredEvidence(value: unknown): ScopeEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const parsed = ScopeEvidenceSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

interface SowShape {
  deliverables?: Array<{ id?: string; title?: string; requirementIds?: string[]; acceptanceCriteria?: string[] }>;
  outOfScope?: string[];
}

interface AgreementContentShape {
  description?: string;
  deliverables?: unknown;
  sow?: SowShape;
}

/** Joins fragments as sentences without doubling the punctuation they already end with. */
function sentences(parts: string[]): string {
  return parts
    .map((part) => part.trim().replace(/[.\s]+$/, ""))
    .filter((part) => part.length > 0)
    .join(". ");
}

function clip(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Builds the baseline from the active agreement snapshot and, when there is
 * one, the approved requirements version it was generated from.
 */
export function buildScopeBaseline(input: {
  agreementVersionNumber: number;
  agreementContent: unknown;
  requirements: { versionNumber: number; content: unknown } | null;
}): ScopeBaseline {
  const content = (input.agreementContent ?? {}) as AgreementContentShape;
  const sowLabel = `Agreement v${input.agreementVersionNumber}${content.sow ? " (SOW)" : ""}`;
  const items: BaselineItem[] = [];
  let label = sowLabel;

  let brd: RequirementsContent | null = null;
  if (input.requirements) {
    try {
      brd = parseStoredContent(input.requirements.content);
    } catch {
      brd = null;
    }
  }

  if (brd && input.requirements) {
    const source = `Requirements v${input.requirements.versionNumber}`;
    label = `${source} + ${sowLabel}`;
    for (const item of brd.functional) {
      items.push({
        ref: item.id,
        kind: "REQUIREMENT",
        text: clip(sentences([item.title, item.description, ...item.acceptanceCriteria])),
        source,
      });
    }
    for (const item of brd.nonFunctional) {
      items.push({
        ref: item.id,
        kind: "QUALITY",
        text: clip(sentences([item.title, item.description, ...item.acceptanceCriteria])),
        source,
      });
    }
    for (const item of brd.assumptions) {
      items.push({ ref: item.id, kind: "ASSUMPTION", text: clip(item.text), source });
    }
    brd.constraints.forEach((text, index) =>
      items.push({ ref: `CON-${String(index + 1).padStart(3, "0")}`, kind: "CONSTRAINT", text: clip(text), source }),
    );
    brd.outOfScope.forEach((text, index) =>
      items.push({ ref: `OOS-${String(index + 1).padStart(3, "0")}`, kind: "OUT_OF_SCOPE", text: clip(text), source }),
    );
  }

  if (content.sow?.deliverables) {
    for (const deliverable of content.sow.deliverables) {
      if (!deliverable.id || !deliverable.title) continue;
      items.push({
        ref: deliverable.id,
        kind: "DELIVERABLE",
        text: clip(
          `${deliverable.title}${deliverable.requirementIds?.length ? ` (traces to ${deliverable.requirementIds.join(", ")})` : ""}`,
        ),
        source: sowLabel,
      });
    }
  }
  // SOW exclusions are only added when no BRD supplied them (they are copied from it).
  if (!brd && content.sow?.outOfScope) {
    content.sow.outOfScope.forEach((text, index) =>
      items.push({ ref: `OOS-${String(index + 1).padStart(3, "0")}`, kind: "OUT_OF_SCOPE", text: clip(text), source: sowLabel }),
    );
  }

  if (items.length === 0) {
    // Legacy agreement: no SOW, no BRD — fall back to its deliverables and scope text.
    const deliverables = Array.isArray(content.deliverables)
      ? content.deliverables.filter((item): item is string => typeof item === "string")
      : [];
    deliverables.forEach((text, index) =>
      items.push({ ref: `SCOPE-${String(index + 1).padStart(3, "0")}`, kind: "DELIVERABLE", text: clip(text), source: sowLabel }),
    );
    if (content.description) {
      items.push({ ref: "SCOPE-DESC", kind: "DELIVERABLE", text: clip(content.description), source: sowLabel });
    }
  }

  return { label, items };
}

export interface EvidencedClassification {
  label: "INCLUDED" | "OUTSIDE_SCOPE" | "AMBIGUOUS";
  rationale: string;
  evidence: ScopeEvidence[];
}

const IN_SCOPE_KINDS: BaselineKind[] = ["REQUIREMENT", "QUALITY", "DELIVERABLE"];

function sharedTerms(proposal: Set<string>, text: string): string[] {
  return [...new Set(tokenize(text))].filter((token) => proposal.has(token));
}

/**
 * Deterministic classification with evidence:
 *  1. An explicit exclusion that the proposal matches wins → OUTSIDE_SCOPE.
 *  2. Otherwise the share of the proposal's terms found in in-scope items
 *     decides: ≥ 60% INCLUDED, ≤ 20% OUTSIDE_SCOPE, else AMBIGUOUS.
 * Every label cites the items it relied on (or the nearest ones it rejected).
 */
export function classifyAgainstBaseline(proposalText: string, baseline: ScopeBaseline): EvidencedClassification {
  const proposalTokens = tokenize(proposalText);
  const proposal = new Set(proposalTokens);

  if (proposalTokens.length === 0) {
    return {
      label: "AMBIGUOUS",
      rationale: `The proposed change has no substantive terms to compare with ${baseline.label}. Both parties should describe the change concretely and review it manually before voting.`,
      evidence: [],
    };
  }

  // 1. Explicit exclusions.
  const exclusions = baseline.items
    .filter((item) => item.kind === "OUT_OF_SCOPE")
    .map((item) => {
      const terms = sharedTerms(proposal, item.text);
      const itemTokens = new Set(tokenize(item.text));
      return { item, terms, share: itemTokens.size > 0 ? terms.length / itemTokens.size : 0 };
    })
    .filter((match) => match.terms.length >= 2 || (match.terms.length === 1 && match.share >= 0.5))
    .sort((a, b) => b.terms.length - a.terms.length);
  if (exclusions.length > 0) {
    const top = exclusions.slice(0, 3);
    return {
      label: "OUTSIDE_SCOPE",
      rationale: `The proposal matches work the parties explicitly excluded in ${baseline.label}: ${top
        .map((match) => `${match.item.ref} ("${clip(match.item.text, 120)}")`)
        .join("; ")}. Excluded work needs an approved change to become part of the agreement.`,
      evidence: top.map((match) => ({
        ref: match.item.ref,
        relation: "EXCLUDED_BY" as const,
        text: match.item.text,
        matchedTerms: match.terms.slice(0, 10),
      })),
    };
  }

  // 2. Coverage by in-scope items.
  const inScope = baseline.items.filter((item) => IN_SCOPE_KINDS.includes(item.kind));
  const scored = inScope
    .map((item) => ({ item, terms: sharedTerms(proposal, item.text) }))
    .sort((a, b) => b.terms.length - a.terms.length);
  const covered = new Set(scored.flatMap((match) => match.terms));
  const coverage = covered.size / proposal.size;
  const supporting = scored.filter((match) => match.terms.length > 0).slice(0, 4);
  const percent = Math.round(coverage * 100);
  const uncovered = [...proposal].filter((token) => !covered.has(token)).slice(0, 6);

  if (coverage >= 0.6 && supporting.length > 0) {
    return {
      label: "INCLUDED",
      rationale: `${percent}% of the proposal's terms are already described by ${supporting
        .map((match) => match.item.ref)
        .join(", ")} in ${baseline.label}. The requested work appears to be covered by the agreed scope.`,
      evidence: supporting.map((match) => ({
        ref: match.item.ref,
        relation: "COVERED_BY" as const,
        text: match.item.text,
        matchedTerms: match.terms.slice(0, 10),
      })),
    };
  }

  if (coverage <= 0.2) {
    const nearest = scored.slice(0, 2);
    return {
      label: "OUTSIDE_SCOPE",
      rationale: `No requirement or deliverable in ${baseline.label} describes this work: only ${percent}% of its terms appear in the agreed scope${
        uncovered.length ? ` (not covered: ${uncovered.join(", ")})` : ""
      }. The closest items checked were ${nearest.map((match) => match.item.ref).join(", ") || "none"}.`,
      evidence: nearest.map((match) => ({
        ref: match.item.ref,
        relation: "NEAREST_TERM" as const,
        text: match.item.text,
        matchedTerms: match.terms.slice(0, 10),
      })),
    };
  }

  return {
    label: "AMBIGUOUS",
    rationale: `The proposal overlaps ${supporting.map((match) => match.item.ref).join(", ")} in ${baseline.label} (${percent}% of its terms) but also adds work they do not describe${
      uncovered.length ? ` (${uncovered.join(", ")})` : ""
    }. Both parties should agree where the boundary is before voting.`,
    evidence: supporting.map((match) => ({
      ref: match.item.ref,
      relation: "PARTIALLY_COVERED_BY" as const,
      text: match.item.text,
      matchedTerms: match.terms.slice(0, 10),
    })),
  };
}

/**
 * Keeps only evidence that points at a real baseline item, with the text taken
 * from the baseline rather than the model. A decisive label (INCLUDED or
 * OUTSIDE_SCOPE) left with no valid evidence is downgraded to AMBIGUOUS.
 */
export function enforceEvidence(
  classification: { label: EvidencedClassification["label"]; rationale: string; evidence?: ScopeEvidence[] },
  baseline: ScopeBaseline,
): EvidencedClassification {
  const byRef = new Map(baseline.items.map((item) => [item.ref, item]));
  const evidence = (classification.evidence ?? [])
    .filter((entry) => byRef.has(entry.ref))
    .map((entry) => ({ ...entry, text: byRef.get(entry.ref)!.text }));
  if (classification.label !== "AMBIGUOUS" && evidence.length === 0 && baseline.items.length > 0) {
    return {
      label: "AMBIGUOUS",
      rationale: clip(
        `The AI suggested ${classification.label} but cited no item from ${baseline.label}, so the label was set to AMBIGUOUS. Both parties should review the change manually. Original reasoning: ${classification.rationale}`,
        1000,
      ),
      evidence: [],
    };
  }
  return { label: classification.label, rationale: classification.rationale, evidence };
}
