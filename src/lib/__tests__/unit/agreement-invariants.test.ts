import { describe, expect, it } from "vitest";
import { approvalSummary, isDualApproved, nextVersionNumber, type ApprovalLike } from "@/lib/agreements/invariants";

function approval(
  actorRole: "CLIENT" | "FREELANCER",
  versionNumber: number,
  state: "PENDING" | "APPROVED" = "APPROVED",
): ApprovalLike {
  return { actorRole, versionNumber, state };
}

describe("version numbering (Property 1)", () => {
  it("starts at 1 when no version exists yet", () => {
    expect(nextVersionNumber(null)).toBe(1);
    expect(nextVersionNumber(undefined)).toBe(1);
    expect(nextVersionNumber(0)).toBe(1);
  });

  it("always returns the maximum plus one", () => {
    expect(nextVersionNumber(1)).toBe(2);
    expect(nextVersionNumber(7)).toBe(8);
  });

  it("is strictly increasing for any existing maximum", () => {
    for (let max = 0; max < 25; max += 1) {
      const next = nextVersionNumber(max);
      expect(next).toBeGreaterThan(max);
      expect(next - max).toBe(1);
    }
  });
});

describe("dual-approval gating (Property 2)", () => {
  it("requires one approval from each side on the current version", () => {
    expect(isDualApproved([approval("CLIENT", 1), approval("FREELANCER", 1)], 1)).toBe(true);
  });

  it("is false with only one side approved", () => {
    expect(isDualApproved([approval("CLIENT", 1)], 1)).toBe(false);
    expect(isDualApproved([approval("FREELANCER", 1)], 1)).toBe(false);
    expect(isDualApproved([], 1)).toBe(false);
  });

  it("ignores approvals recorded against an earlier version", () => {
    const approvals = [approval("CLIENT", 1), approval("FREELANCER", 1)];
    expect(isDualApproved(approvals, 2)).toBe(false);
  });

  it("ignores pending and retracted-in-effect approvals", () => {
    expect(
      isDualApproved([approval("CLIENT", 1, "PENDING"), approval("FREELANCER", 1, "APPROVED")], 1),
    ).toBe(false);
    expect(
      isDualApproved([approval("CLIENT", 1, "APPROVED"), approval("FREELANCER", 1, "PENDING")], 1),
    ).toBe(false);
    expect(
      isDualApproved([approval("CLIENT", 1, "PENDING"), approval("FREELANCER", 1, "PENDING")], 1),
    ).toBe(false);
  });

  it("rejects a duplicated approval from one side", () => {
    expect(
      isDualApproved([approval("CLIENT", 1), approval("CLIENT", 1), approval("FREELANCER", 1)], 1),
    ).toBe(false);
  });

  it("summarises each side's state for the current version only", () => {
    const approvals = [
      approval("CLIENT", 2),
      approval("FREELANCER", 2, "PENDING"),
      approval("FREELANCER", 1),
    ];
    expect(approvalSummary(approvals, 2)).toEqual({ clientApproved: true, freelancerApproved: false });
    expect(approvalSummary(approvals, 1)).toEqual({ clientApproved: false, freelancerApproved: true });
  });
});
