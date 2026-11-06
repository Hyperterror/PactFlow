import type { Invitation, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { withTransaction, writeAuditLog } from "@/lib/audit";

export type ProjectRole = "CLIENT" | "FREELANCER";

export interface ProjectParticipant {
  role: ProjectRole;
  otherPartyId: string;
}

/**
 * Requirement 23.6 — access-control violations are logged with the requesting
 * user id, the resource identifier and the UTC timestamp (the timestamp is the
 * audit row's createdAt).
 */
export async function recordAccessViolation(input: {
  actorId: string;
  resourceId: string;
  resourceType: string;
  reason: string;
}): Promise<void> {
  try {
    await withTransaction(async (tx) => {
      await writeAuditLog(tx, {
        eventType: "ACCESS_VIOLATION",
        actorId: input.actorId,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        previousState: null,
        newState: "DENIED",
        metadata: { reason: input.reason },
      });
    });
  } catch (error) {
    // Never let violation logging mask the original 403.
    console.error("[access] failed to record violation", error);
  }
}

export function isAcceptedInvitation(invitation: Invitation | null): boolean {
  return invitation?.status === "ACCEPTED";
}

/** Client ownership check for a Brief; logs the violation on failure. */
export async function assertBriefOwner(briefId: string, userId: string) {
  const brief = await prisma.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");
  if (brief.clientId !== userId) {
    await recordAccessViolation({
      actorId: userId,
      resourceId: briefId,
      resourceType: "Brief",
      reason: "NOT_BRIEF_OWNER",
    });
    throw new ForbiddenError("NOT_BRIEF_OWNER", "Only the owning Client may perform this action.");
  }
  return brief;
}

/**
 * Read access to a Brief: the owning Client or a Freelancer whose invitation
 * was accepted (Requirement 23.2).
 */
export async function assertBriefAccess(
  briefId: string,
  userId: string,
): Promise<{ brief: Awaited<ReturnType<typeof prisma.brief.findUnique>> & object; role: ProjectRole }> {
  const brief = await prisma.brief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError("Brief");
  if (brief.clientId === userId) {
    return { brief, role: "CLIENT" };
  }
  const invitation = await prisma.invitation.findUnique({
    where: { briefId_freelancerId: { briefId, freelancerId: userId } },
  });
  if (invitation?.status === "ACCEPTED") {
    return { brief, role: "FREELANCER" };
  }
  await recordAccessViolation({
    actorId: userId,
    resourceId: briefId,
    resourceType: "Brief",
    reason: "NOT_PROJECT_PARTICIPANT",
  });
  throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this project.");
}

export interface AgreementContext {
  agreement: Prisma.AgreementGetPayload<object>;
  role: ProjectRole;
  otherPartyId: string;
}

export async function assertAgreementParticipant(
  agreementId: string,
  userId: string,
): Promise<AgreementContext> {
  const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
  if (!agreement) throw new NotFoundError("Agreement");
  if (agreement.clientId === userId) {
    return { agreement, role: "CLIENT", otherPartyId: agreement.freelancerId };
  }
  if (agreement.freelancerId === userId) {
    return { agreement, role: "FREELANCER", otherPartyId: agreement.clientId };
  }
  await recordAccessViolation({
    actorId: userId,
    resourceId: agreementId,
    resourceType: "Agreement",
    reason: "NOT_PROJECT_PARTICIPANT",
  });
  throw new ForbiddenError("NOT_PROJECT_PARTICIPANT", "You are not a participant on this project.");
}

export async function requireRole(
  agreementId: string,
  userId: string,
  role: ProjectRole,
): Promise<AgreementContext> {
  const context = await assertAgreementParticipant(agreementId, userId);
  if (context.role !== role) {
    await recordAccessViolation({
      actorId: userId,
      resourceId: agreementId,
      resourceType: "Agreement",
      reason: "WRONG_ROLE",
    });
    throw new ForbiddenError("WRONG_ROLE", `This action requires the ${role} role.`);
  }
  return context;
}

/** A Freelancer must hold an ACCEPTED invitation before quoting. */
export async function assertAcceptedInvitation(briefId: string, freelancerId: string): Promise<Invitation> {
  const invitation = await prisma.invitation.findUnique({
    where: { briefId_freelancerId: { briefId, freelancerId } },
  });
  if (!invitation || invitation.status !== "ACCEPTED") {
    await recordAccessViolation({
      actorId: freelancerId,
      resourceId: briefId,
      resourceType: "Brief",
      reason: "INVITATION_NOT_ACCEPTED",
    });
    throw new ForbiddenError(
      "INVITATION_NOT_ACCEPTED",
      "An accepted invitation is required to work on this Brief.",
    );
  }
  return invitation;
}

/** Platform operators are configured through OPERATOR_EMAILS (comma separated). */
export function isPlatformOperator(email: string): boolean {
  const operators = (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return operators.includes(email.trim().toLowerCase());
}
