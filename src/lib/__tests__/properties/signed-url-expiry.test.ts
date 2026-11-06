import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_SIGNED_URL_SECONDS, generateStorageKey, generateSignedUrl } from "@/lib/storage";

/**
 * **Property 11: Signed URL Expiry Bound**
 * **Validates: Requirements 19.1, 19.2, 23.3, 27.11**
 *
 * For any generation timestamp and any requested lifetime — including zero,
 * negative and absurdly large values — the issued URL must expire strictly in the
 * future and never more than 60 minutes after it was generated.
 */

const nowArb = fc.date({
  min: new Date("2000-01-01T00:00:00.000Z"),
  max: new Date("2100-01-01T00:00:00.000Z"),
  noInvalidDate: true,
});

const requestedTtlArb = fc.oneof(
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.integer({ min: 0, max: MAX_SIGNED_URL_SECONDS }),
  fc.constant(MAX_SIGNED_URL_SECONDS),
  fc.constant(MAX_SIGNED_URL_SECONDS * 1000),
  fc.constant(0),
  fc.constant(-1),
);

describe("Property 11 — signed URL expiry bound", () => {
  it("never issues a URL that expires in the past or beyond 60 minutes", async () => {
    await fc.assert(
      fc.asyncProperty(nowArb, requestedTtlArb, async (now, requested) => {
        const key = generateStorageKey();
        const issued = await generateSignedUrl(key, requested, now);

        const lifetimeMs = issued.expiresAt.getTime() - now.getTime();
        expect(lifetimeMs).toBeGreaterThan(0);
        expect(lifetimeMs).toBeLessThanOrEqual(MAX_SIGNED_URL_SECONDS * 1000);
      }),
      { numRuns: 100 },
    );
  });

  it("honours any lifetime inside the bound exactly", async () => {
    await fc.assert(
      fc.asyncProperty(
        nowArb,
        fc.integer({ min: 1, max: MAX_SIGNED_URL_SECONDS }),
        async (now, requested) => {
          const issued = await generateSignedUrl(generateStorageKey(), requested, now);
          expect(issued.expiresAt.getTime() - now.getTime()).toBe(requested * 1000);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clamps an oversized request to the 60-minute ceiling", async () => {
    await fc.assert(
      fc.asyncProperty(
        nowArb,
        fc.integer({ min: MAX_SIGNED_URL_SECONDS + 1, max: 10_000_000 }),
        async (now, requested) => {
          const issued = await generateSignedUrl(generateStorageKey(), requested, now);
          expect(issued.expiresAt.getTime() - now.getTime()).toBe(MAX_SIGNED_URL_SECONDS * 1000);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("produces a URL whose expiry parameter matches the returned expiry", async () => {
    await fc.assert(
      fc.asyncProperty(nowArb, requestedTtlArb, async (now, requested) => {
        const issued = await generateSignedUrl(generateStorageKey(), requested, now, "event-1");
        const expires = Number(new URL(issued.url).searchParams.get("expires"));
        expect(expires).toBe(Math.floor(issued.expiresAt.getTime() / 1000));
      }),
      { numRuns: 100 },
    );
  });
});
