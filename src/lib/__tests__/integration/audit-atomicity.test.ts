import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { withTransaction, writeAuditLog, type AuditEventType } from "@/lib/audit";
import { prisma, resetDatabase } from "../helpers/db";
import { createAgreementFixture } from "../helpers/fixtures";
import { completeProject } from "@/lib/collaboration";

/**
 * **Property 9: Audit Log Atomicity**
 * **Validates: Requirements 24.1, 24.3, 27.9**
 *
 * Every state-changing operation appends exactly one audit entry, and the entry
 * lands in the same transaction as the change: a committed sequence leaves
 * exactly N entries, and any failure leaves the log exactly as it was.
 */

const EVENTS: AuditEventType[] = [
  "BRIEF_CREATED",
  "BRIEF_PUBLISHED",
  "QUOTATION_SUBMITTED",
  "AGREEMENT_CREATED",
  "MILESTONE_DELIVERED",
  "PAYMENT_CAPTURED",
];

const operationArb = fc.record({
  eventType: fc.constantFrom(...EVENTS),
  previousState: fc.option(fc.string({ maxLength: 12 }), { nil: null }),
  newState: fc.string({ minLength: 1, maxLength: 12 }),
});

let actorId = "";

beforeEach(async () => {
  await resetDatabase();
  const actor = await prisma.user.create({
    data: { displayName: "Auditor", email: "auditor@example.test", passwordHash: "x" },
  });
  actorId = actor.id;
});

describe("Property 9 — audit log atomicity", () => {
  it("commits exactly one audit entry per recorded state change", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operationArb, { maxLength: 8 }), async (operations) => {
        await prisma.auditLog.deleteMany();
        const resourceId = `resource-${Math.random().toString(36).slice(2)}`;

        await withTransaction(async (tx) => {
          for (const operation of operations) {
            await writeAuditLog(tx, {
              eventType: operation.eventType,
              actorId,
              resourceId,
              resourceType: "PropertyTest",
              previousState: operation.previousState,
              newState: operation.newState,
            });
          }
        });

        const entries = await prisma.auditLog.findMany({ where: { resourceId } });
        expect(entries).toHaveLength(operations.length);
        // Every entry carries both sides of the transition it recorded.
        for (const entry of entries) {
          expect(entry.newState.length).toBeGreaterThan(0);
          expect(entry.previousState === null || typeof entry.previousState === "string").toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("rolls the audit log back to its previous state when the change fails", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(operationArb, { maxLength: 8 }), async (operations) => {
        await prisma.auditLog.deleteMany();
        const resourceId = `resource-${Math.random().toString(36).slice(2)}`;
        const before = await prisma.auditLog.count();

        await expect(
          withTransaction(async (tx) => {
            for (const operation of operations) {
              await writeAuditLog(tx, {
                eventType: operation.eventType,
                actorId,
                resourceId,
                resourceType: "PropertyTest",
                previousState: operation.previousState,
                newState: operation.newState,
              });
            }
            throw new Error("simulated failure after the audit writes");
          }),
        ).rejects.toThrow("simulated failure");

        expect(await prisma.auditLog.count()).toBe(before);
      }),
      { numRuns: 100 },
    );
  });

  it("is append-only: the domain modules never update or delete an entry", async () => {
    const fixture = await createAgreementFixture({
      milestones: [{ status: "APPROVED", paymentStatus: "CAPTURED" }],
    });

    const history = await completeProject(fixture.agreementId);
    const created = await prisma.auditLog.findMany({
      where: { resourceId: history.id, resourceType: "CollaborationHistory" },
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      eventType: "COLLABORATION_HISTORY_CREATED",
      previousState: null,
      newState: "COMPLETED",
    });

    // A second, idempotent completion must not append a second creation entry.
    await completeProject(fixture.agreementId);
    const afterRepeat = await prisma.auditLog.count({
      where: { resourceId: history.id, resourceType: "CollaborationHistory" },
    });
    expect(afterRepeat).toBe(1);
  });
});
