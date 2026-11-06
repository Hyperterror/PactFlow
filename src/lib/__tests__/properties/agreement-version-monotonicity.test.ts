import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextVersionNumber } from "@/lib/agreements/invariants";

/**
 * **Property 1: Agreement Version Monotonicity**
 * **Validates: Requirements 9.6, 27.1**
 *
 * An arbitrary sequence of `createNewVersion` calls on the same Agreement must
 * produce 1, 2, 3, … — each number exactly one more than the previous maximum
 * and no number ever reused.
 */
describe("Property 1 — Agreement version monotonicity", () => {
  it("starts at 1 for an agreement with no versions", () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (maxExisting) => {
        expect(nextVersionNumber(maxExisting)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("always returns the previous maximum plus one", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (maxExisting) => {
        expect(nextVersionNumber(maxExisting)).toBe(maxExisting + 1);
      }),
      { numRuns: 100 },
    );
  });

  it("produces strictly increasing, gap-free versions over any call sequence", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (callCount) => {
        // `max` starts at null (no versions yet) and is threaded through every
        // call, exactly as `createNewVersion` reads the current maximum.
        let max: number | null = null;
        const issued: number[] = [];
        for (let call = 0; call < callCount; call += 1) {
          const next = nextVersionNumber(max);
          issued.push(next);
          max = next;
        }

        expect(new Set(issued).size).toBe(issued.length);
        issued.forEach((version, index) => expect(version).toBe(index + 1));
      }),
      { numRuns: 100 },
    );
  });

  it("cannot reuse a number even after an out-of-order maximum is observed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5_000 }), (maxExisting) => {
        const next = nextVersionNumber(maxExisting);
        expect(next).toBeGreaterThan(maxExisting);
        expect(next).not.toBe(maxExisting);
      }),
      { numRuns: 100 },
    );
  });
});
