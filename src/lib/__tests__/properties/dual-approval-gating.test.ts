import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ApprovalState } from "@prisma/client";
import { approvalSummary, isDualApproved, type ApprovalLike } from "@/lib/agreements/invariants";

/**
 * **Property 2: Dual-Approval Gating**
 * **Validates: Requirements 9.3, 9.4, 27.2**
 *
 * An Agreement may become ACTIVE if and only if exactly one CLIENT approval and
 * one FREELANCER approval exist, both APPROVED, both for the current version.
 * Every other combination — including approvals carried over from a previous
 * version — must leave the gate closed.
 */

const ROLES = ["CLIENT", "FREELANCER"] as const;
const STATES: ApprovalState[] = ["PENDING", "APPROVED"];

const approvalArb: fc.Arbitrary<ApprovalLike> = fc.record({
  actorRole: fc.constantFrom(...ROLES),
  versionNumber: fc.integer({ min: 1, max: 4 }),
  state: fc.constantFrom(...STATES),
});

/** The reference definition of the gate, written independently of the module. */
function expectedGate(approvals: ApprovalLike[], currentVersion: number): boolean {
  let client = 0;
  let freelancer = 0;
  for (const approval of approvals) {
    if (approval.versionNumber !== currentVersion) continue;
    if (approval.state !== "APPROVED") continue;
    if (approval.actorRole === "CLIENT") client += 1;
    if (approval.actorRole === "FREELANCER") freelancer += 1;
  }
  return client === 1 && freelancer === 1;
}

describe("Property 2 — dual-approval gating", () => {
  it("agrees with the reference gate for any combination of approval records", () => {
    fc.assert(
      fc.property(
        fc.array(approvalArb, { maxLength: 8 }),
        fc.integer({ min: 1, max: 4 }),
        (approvals, currentVersion) => {
          expect(isDualApproved(approvals, currentVersion)).toBe(
            expectedGate(approvals, currentVersion),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never opens the gate on a partial set", () => {
    fc.assert(
      fc.property(
        fc.array(approvalArb, { maxLength: 6 }),
        fc.integer({ min: 1, max: 4 }),
        (approvals, currentVersion) => {
          const hasBothRoles = ROLES.every((role) =>
            approvals.some(
              (approval) =>
                approval.actorRole === role &&
                approval.state === "APPROVED" &&
                approval.versionNumber === currentVersion,
            ),
          );
          if (!hasBothRoles) {
            expect(isDualApproved(approvals, currentVersion)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ignores approvals recorded against any other version", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.integer({ min: 1, max: 3 }),
        (currentVersion, staleVersion) => {
          fc.pre(currentVersion !== staleVersion);
          const stale: ApprovalLike[] = [
            { actorRole: "CLIENT", versionNumber: staleVersion, state: "APPROVED" },
            { actorRole: "FREELANCER", versionNumber: staleVersion, state: "APPROVED" },
          ];
          expect(isDualApproved(stale, currentVersion)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("opens the gate as soon as both parties approve the current version", () => {
    fc.assert(
      fc.property(
        fc.array(approvalArb, { maxLength: 4 }),
        fc.integer({ min: 1, max: 4 }),
        (prior, currentVersion) => {
          // Only records for other versions, so the pair below is the sole
          // source of approval for the current version.
          const stale = prior.map((approval) => ({
            ...approval,
            versionNumber: currentVersion + 1,
          }));
          const approvals: ApprovalLike[] = [
            ...stale,
            { actorRole: "CLIENT", versionNumber: currentVersion, state: "APPROVED" },
            { actorRole: "FREELANCER", versionNumber: currentVersion, state: "APPROVED" },
          ];
          expect(isDualApproved(approvals, currentVersion)).toBe(true);
          expect(approvalSummary(approvals, currentVersion)).toEqual({
            clientApproved: true,
            freelancerApproved: true,
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("treats a pending approval as no approval", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES), (role) => {
        const other = role === "CLIENT" ? "FREELANCER" : "CLIENT";
        const approvals: ApprovalLike[] = [
          { actorRole: other, versionNumber: 1, state: "APPROVED" },
          { actorRole: role, versionNumber: 1, state: "PENDING" },
        ];
        expect(isDualApproved(approvals, 1)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
