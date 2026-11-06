import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import type { PaymentStatus } from "@prisma/client";
import { issueSignedUrl } from "@/lib/storage/signed-url";
import { deleteObject, putObject } from "@/lib/storage";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { prisma, resetDatabase } from "../helpers/db";
import { createDeliverableFixture } from "../helpers/fixtures";

/**
 * **Property 5: Payment-Before-Delivery**
 * **Validates: Requirements 15.6, 15.7, 17.3, 19.4, 27.5**
 *
 * A Signed_URL is issued if and only if the milestone payment is CAPTURED.
 * Every other payment state — PENDING, FAILED, REVIEW_REQUIRED, or no Payment
 * row at all — must produce HTTP 403 and must not hand back a URL.
 */

const PAYMENT_STATES: Array<PaymentStatus | null> = [
  "PENDING",
  "CAPTURED",
  "FAILED",
  "REVIEW_REQUIRED",
  null,
];

const statusArb = fc.constantFrom(...PAYMENT_STATES);

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Property 5 — payment-before-delivery", () => {
  it("issues a URL for the paying Client only when the payment is CAPTURED", async () => {
    await fc.assert(
      fc.asyncProperty(statusArb, async (paymentStatus) => {
        const body = Buffer.from("%PDF-1.7 property 5 deliverable\n");
        const fixture = await createDeliverableFixture({
          milestones: [{ status: "APPROVED", paymentStatus }],
          body,
        });
        await putObject(fixture.originalKey, body, "application/pdf");

        try {
          if (paymentStatus === "CAPTURED") {
            const issued = await issueSignedUrl(fixture.deliverableId, fixture.client.id);
            expect(issued.deliverableId).toBe(fixture.deliverableId);
            expect(issued.url).toContain("sig=");
          } else {
            await expect(
              issueSignedUrl(fixture.deliverableId, fixture.client.id),
            ).rejects.toMatchObject({ status: 403, reason: "PAYMENT_NOT_CAPTURED" });
          }
        } finally {
          await deleteObject(fixture.originalKey);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never serves the original file to the Freelancer, whatever the payment state", async () => {
    await fc.assert(
      fc.asyncProperty(statusArb, async (paymentStatus) => {
        const fixture = await createDeliverableFixture({
          milestones: [{ status: "APPROVED", paymentStatus }],
        });

        const error = await issueSignedUrl(fixture.deliverableId, fixture.freelancer.id).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).status).toBe(403);
        // The Freelancer is never the paying party, so the door stays shut.
        expect((error as ForbiddenError).reason).toBe("NOT_PAYING_CLIENT");
      }),
      { numRuns: 100 },
    );
  });

  it("refuses a stranger who is neither party on the agreement", async () => {
    await fc.assert(
      fc.asyncProperty(statusArb, async (paymentStatus) => {
        const fixture = await createDeliverableFixture({
          milestones: [{ status: "APPROVED", paymentStatus }],
        });
        const outsider = await prisma.user.create({
          data: {
            displayName: "Outsider",
            email: `outsider-${Math.random().toString(36).slice(2)}@example.test`,
            passwordHash: "x",
          },
        });

        const error = await issueSignedUrl(fixture.deliverableId, outsider.id).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ForbiddenError);
        expect((error as ForbiddenError).reason).toBe("NOT_PAYING_CLIENT");
      }),
      { numRuns: 100 },
    );
  });

  it("withholds the URL when the stored binary no longer matches its hash", async () => {
    // The operator alert is deliberate production behaviour; keep the output clean.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fixture = await createDeliverableFixture({
      milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
    });
    // Stored bytes differ from the hash recorded at upload time.
    await putObject(fixture.originalKey, Buffer.from("%PDF-1.7 tampered\n"), "application/pdf");

    try {
      const error = await issueSignedUrl(fixture.deliverableId, fixture.client.id).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).status).toBe(409);
    } finally {
      await deleteObject(fixture.originalKey);
    }
  });
});
