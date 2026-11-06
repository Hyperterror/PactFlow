import type { AgreementApproval } from "@prisma/client";

export type ApprovalLike = Pick<AgreementApproval, "actorRole" | "versionNumber" | "state">;

/**
 * Property 1 — version numbers are sequential integers starting at 1.
 * The next version is always the current maximum plus one.
 */
export function nextVersionNumber(maxExisting: number | null | undefined): number {
  return (maxExisting ?? 0) + 1;
}

/**
 * Property 2 — dual-approval gating.
 *
 * An Agreement becomes ACTIVE if and only if there is exactly one CLIENT
 * approval and one FREELANCER approval, both APPROVED, both referencing the
 * Agreement's current (latest) version. Approvals for earlier versions never
 * satisfy the gate, and a PARTIAL set (only one side) never does either.
 *
 * Note: `approvedAt` is intentionally not consulted — a UTC epoch timestamp of
 * 0 is a valid approval time (Requirement 9.4).
 */
export function isDualApproved(approvals: ApprovalLike[], currentVersion: number): boolean {
  const current = approvals.filter(
    (approval) => approval.versionNumber === currentVersion && approval.state === "APPROVED",
  );
  const client = current.filter((approval) => approval.actorRole === "CLIENT").length;
  const freelancer = current.filter((approval) => approval.actorRole === "FREELANCER").length;
  return client === 1 && freelancer === 1;
}

/** True when a version is fully approved, i.e. the Agreement may go ACTIVE. */
export function approvalSummary(approvals: ApprovalLike[], currentVersion: number) {
  const current = approvals.filter((approval) => approval.versionNumber === currentVersion);
  return {
    clientApproved: current.some((a) => a.actorRole === "CLIENT" && a.state === "APPROVED"),
    freelancerApproved: current.some((a) => a.actorRole === "FREELANCER" && a.state === "APPROVED"),
  };
}
