import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { completeProject, isProjectComplete } from "@/lib/collaboration";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture } from "../helpers/fixtures";

/**
 * **Property 10: Collaboration History Append-Only**
 * **Validates: Requirements 20.1, 20.2, 27.10**
 *
 * Completing a project appends a history entry; it never rewrites or removes an
 * existing one. Repeated completion calls are idempotent, and the count of
 * entries is monotonically non-decreasing as further projects complete.
 */

beforeEach(async () => {
  await resetDatabase();
});

describe("Property 10 — collaboration history append-only", () => {
  it("appends exactly one entry per completed project, however often it is called", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (repeatCalls) => {
        await resetDatabase();
        const fixture = await createAgreementFixture({
          milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
        });

        expect(await isProjectComplete(fixture.agreementId)).toBe(true);

        const first = await completeProject(fixture.agreementId);
        const firstSnapshot = {
          id: first.id,
          agreementId: first.agreementId,
          completedAt: first.completedAt.toISOString(),
          totalPaymentAmount: first.totalPaymentAmount.toString(),
          agreementSnapshot: JSON.stringify(first.agreementSnapshot),
          deliverables: JSON.stringify(first.deliverables),
        };

        for (let call = 0; call < repeatCalls; call += 1) {
          const again = await completeProject(fixture.agreementId);
          expect(again.id).toBe(first.id);
          // Every recorded field is byte-identical: nothing was rewritten.
          expect({
            id: again.id,
            agreementId: again.agreementId,
            completedAt: again.completedAt.toISOString(),
            totalPaymentAmount: again.totalPaymentAmount.toString(),
            agreementSnapshot: JSON.stringify(again.agreementSnapshot),
            deliverables: JSON.stringify(again.deliverables),
          }).toEqual(firstSnapshot);
        }

        expect(await prisma.collaborationHistory.count()).toBe(1);
        // One creation audit entry, and only one.
        expect(
          await prisma.auditLog.count({
            where: { resourceId: first.id, eventType: "COLLABORATION_HISTORY_CREATED" },
          }),
        ).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("never loses an entry as further projects complete", async () => {
    const projects = 3;
    const counts: number[] = [];

    for (let index = 0; index < projects; index += 1) {
      const fixture = await createAgreementFixture({
        milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
      });
      await completeProject(fixture.agreementId);
      counts.push(await prisma.collaborationHistory.count());
    }

    expect(counts).toEqual([1, 2, 3]);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
    }
  });

  it("does not record a project that is not actually complete", async () => {
    const fixture = await createAgreementFixture({
      milestones: [{ status: "APPROVED", paymentStatus: "PENDING" }],
    });
    expect(await isProjectComplete(fixture.agreementId)).toBe(false);

    // Another party's preferences and summaries can still be added; the history
    // entry is only appended once the payment side is captured.
    expect(await prisma.collaborationHistory.count()).toBe(0);
  });

  it("keeps the earlier entry intact when a later project is appended", async () => {
    const firstFixture = await createAgreementFixture({
      milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
    });
    const firstHistory = await completeProject(firstFixture.agreementId);
    const firstCompletedAt = firstHistory.completedAt.toISOString();

    const secondFixture = await createAgreementFixture({
      milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
    });
    await completeProject(secondFixture.agreementId);

    const reloaded = await prisma.collaborationHistory.findUniqueOrThrow({
      where: { id: firstHistory.id },
    });
    expect(reloaded.completedAt.toISOString()).toBe(firstCompletedAt);
    expect(reloaded.agreementId).toBe(firstFixture.agreementId);
    expect(await prisma.collaborationHistory.count()).toBe(2);
  });
});
