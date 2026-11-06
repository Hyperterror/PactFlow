import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { sha256Hex, verifyIntegrity, putObject, deleteObject } from "@/lib/storage";

/**
 * **Property 3: SHA-256 Hash Consistency**
 * **Validates: Requirements 14.2, 19.3, 27.3**
 *
 * The hash computed at upload must equal the hash recomputed from the bytes that
 * were actually stored. Any single-byte change must break the comparison, which
 * is what stops a tampered file from being served.
 */

const binaryArb: fc.Arbitrary<Buffer> = fc
  .uint8Array({ minLength: 0, maxLength: 512 })
  .map((bytes) => Buffer.from(bytes));

describe("Property 3 — SHA-256 hash consistency", () => {
  it("matches an independent implementation for arbitrary binaries", () => {
    fc.assert(
      fc.property(binaryArb, (bytes) => {
        expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
        expect(sha256Hex(bytes)).toHaveLength(64);
      }),
      { numRuns: 100 },
    );
  });

  it("is stable: hashing the same bytes twice yields the same digest", () => {
    fc.assert(
      fc.property(binaryArb, (bytes) => {
        expect(sha256Hex(Buffer.from(bytes))).toBe(sha256Hex(Buffer.from(bytes)));
      }),
      { numRuns: 100 },
    );
  });

  it("changes for every single-byte mutation", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 256 }),
        fc.nat(),
        fc.integer({ min: 1, max: 255 }),
        (bytes, indexSeed, delta) => {
          const original = Buffer.from(bytes);
          const index = indexSeed % original.length;
          const tampered = Buffer.from(original);
          tampered[index] = (tampered[index] + delta) % 256;
          fc.pre(tampered[index] !== original[index]);

          expect(sha256Hex(tampered)).not.toBe(sha256Hex(original));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("verifies integrity of the stored bytes and rejects a stale hash", async () => {
    const key = `obj_prop3_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const body = Buffer.from("%PDF-1.7 stored deliverable bytes\n");
    await putObject(key, body, "application/pdf");

    try {
      // The upload-time hash is derived from the same bytes, so it still matches
      // after the round-trip through storage.
      await expect(verifyIntegrity(key, sha256Hex(body))).resolves.toBe(true);
      // A hash of any other content must not verify.
      await expect(verifyIntegrity(key, sha256Hex(Buffer.from("other")))).resolves.toBe(false);
    } finally {
      await deleteObject(key);
    }
  });

  it("withholds verification when the object is missing", async () => {
    const missing = `obj_missing_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await expect(verifyIntegrity(missing, sha256Hex(Buffer.from("x")))).resolves.toBe(false);
  });
});
