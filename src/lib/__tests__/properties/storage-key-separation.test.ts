import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { generateStorageKey } from "@/lib/storage";

/**
 * **Property 4: Preview–Original Key Separation**
 * **Validates: Requirements 14.7, 23.3, 27.4**
 *
 * The original and preview objects live under two independently generated keys.
 * Nothing about the original key — not its hash, not a prefix, suffix or
 * concatenation — may yield the preview key, so a leaked original key cannot be
 * used to reach the preview or vice versa.
 */

/** Derivations a caller might naively assume; none may produce the other key. */
function derivationsOf(key: string): string[] {
  return [
    key,
    `${key}-preview`,
    `${key}-original`,
    `preview-${key}`,
    `original-${key}`,
    createHash("sha256").update(key).digest("hex"),
    createHash("sha256").update(key).digest("base64url"),
    key.replace(/_/g, "-"),
    key.slice(0, -1),
    key.slice(1),
  ];
}

describe("Property 4 — preview/original key separation", () => {
  it("never issues the same key twice across arbitrary pairs of uploads", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (uploads) => {
        const keys = new Set<string>();
        for (let index = 0; index < uploads; index += 1) {
          const originalKey = generateStorageKey();
          const previewKey = generateStorageKey();
          expect(previewKey).not.toBe(originalKey);
          keys.add(originalKey);
          keys.add(previewKey);
        }
        expect(keys.size).toBe(uploads * 2);
      }),
      { numRuns: 100 },
    );
  });

  it("cannot be reached from the original key by any common derivation", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (uploads) => {
        for (let index = 0; index < uploads; index += 1) {
          const originalKey = generateStorageKey();
          const previewKey = generateStorageKey();
          expect(derivationsOf(originalKey)).not.toContain(previewKey);
          expect(derivationsOf(previewKey)).not.toContain(originalKey);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("emits opaque, filesystem-safe keys that carry no metadata", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 30 }), (uploads) => {
        for (let index = 0; index < uploads; index += 1) {
          const key = generateStorageKey();
          expect(key).toMatch(/^obj_[0-9a-f-]{36}$/);
          expect(/^[A-Za-z0-9._-]+$/.test(key)).toBe(true);
          expect(key.toLowerCase()).not.toContain("preview");
          expect(key.toLowerCase()).not.toContain("original");
        }
      }),
      { numRuns: 100 },
    );
  });
});
