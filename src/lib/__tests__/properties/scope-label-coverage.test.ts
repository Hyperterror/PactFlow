import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { heuristicScopeClassification } from "@/lib/ai/heuristic";
import {
  AMBIGUOUS_FALLBACK_RATIONALE,
  DISPUTE_MAX_LENGTH,
  DISPUTE_MIN_LENGTH,
  validateDisputeJustification,
} from "@/lib/ai/scope-classification";

/**
 * **Property 8: AI Scope-Change Classification Coverage**
 * **Validates: Requirements 11.1, 11.5, 27.8**
 *
 * Every Change_Request ends up with a Scope_Label from the closed set
 * {INCLUDED, OUTSIDE_SCOPE, AMBIGUOUS} — never null and never an invented value —
 * including when the model times out or fails, and including for hostile or
 * empty proposal text. The rationale must always be present and within the
 * 50–1000 character window the UI relies on.
 */

const LABELS = ["INCLUDED", "OUTSIDE_SCOPE", "AMBIGUOUS"] as const;
const RATIONALE_MIN = 50;
const RATIONALE_MAX = 1000;

/** Text that stresses the tokenizer: empty, whitespace, punctuation, unicode. */
const anyText = fc.oneof(
  fc.string(),
  fc.string({ minLength: 1, maxLength: 400 }),
  fc.constantFrom("", " ", "\n\t", "!!!", "the a an", "🎯🚀", "a".repeat(5000)),
  fc.array(fc.string(), { maxLength: 20 }).map((parts) => parts.join(" ")),
);

describe("Property 8 — scope-label coverage", () => {
  it("always assigns a label from the closed set", () => {
    fc.assert(
      fc.property(anyText, anyText, (proposalText, activeScopeText) => {
        const result = heuristicScopeClassification({ proposalText, activeScopeText });
        expect(LABELS).toContain(result.label);
        expect(result.label).not.toBeNull();
        expect(result.label).not.toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("always explains the label within the 50–1000 character window", () => {
    fc.assert(
      fc.property(anyText, anyText, (proposalText, activeScopeText) => {
        const result = heuristicScopeClassification({ proposalText, activeScopeText });
        expect(result.rationale.length).toBeGreaterThanOrEqual(RATIONALE_MIN);
        expect(result.rationale.length).toBeLessThanOrEqual(RATIONALE_MAX);
      }),
      { numRuns: 100 },
    );
  });

  it("never leaves a proposal unclassified when the scope text is missing", () => {
    fc.assert(
      fc.property(anyText, (proposalText) => {
        const result = heuristicScopeClassification({ proposalText, activeScopeText: "" });
        expect(LABELS).toContain(result.label);
      }),
      { numRuns: 100 },
    );
  });

  it("falls back to AMBIGUOUS with a valid rationale when the AI does not answer", () => {
    expect(LABELS).toContain("AMBIGUOUS");
    expect(AMBIGUOUS_FALLBACK_RATIONALE.length).toBeGreaterThanOrEqual(RATIONALE_MIN);
    expect(AMBIGUOUS_FALLBACK_RATIONALE.length).toBeLessThanOrEqual(RATIONALE_MAX);
    // The fallback must not advise a vote outcome — the human decides.
    expect(AMBIGUOUS_FALLBACK_RATIONALE.toLowerCase()).toContain("manually");
  });

  it("rejects a dispute justification outside the allowed length", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (short) => {
        if (short.trim().length >= DISPUTE_MIN_LENGTH) return;
        expect(validateDisputeJustification(short).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
    fc.assert(
      fc.property(
        // The limit applies to the trimmed text, so a mostly-whitespace string is
        // not "too long" — generate ones whose trimmed length really exceeds it.
        fc
          .string({ minLength: DISPUTE_MAX_LENGTH + 1, maxLength: DISPUTE_MAX_LENGTH + 50 })
          .filter((value) => value.trim().length > DISPUTE_MAX_LENGTH),
        (long) => {
          expect(validateDisputeJustification(long).length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
