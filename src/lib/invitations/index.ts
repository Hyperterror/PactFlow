import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Invitation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { withTransaction, writeAuditLog, type TxClient } from "@/lib/audit";
import { INVITATION_TRANSITIONS, assertTransition } from "@/lib/state";
import { send } from "@/lib/notifications";
import { invalidateSignedUrlsForUser } from "@/lib/storage/signed-url";

/** Requirement 3.1 — hard cap of 50 invitations per Brief. */
export const MAX_INVITATIONS_PER_BRIEF = 50;

export const SendInvitationSchema = z
  .object({
    briefId: z.string().min(1, "briefId is required."),
    freelancerId: z.string().min(1).optional(),
    freelancerEmail: z.string().email("Enter a valid email address.").optional(),
  })
  .refine((data) => Boolean(data.freelancerId || data.freelancerEmail), {
    message: "Provide a freelancer ID or email.",
    path: ["freelancerId"],
  });

export type SendInvitationInput = z.infer<typeof SendInvitationSchema>;

async function resolveFreelancer(input: SendInvitationInput) {
  const user = input.freelancerId
    ? await prisma.user.findUnique({ where: { id: input.freelancerId } })
    : await prisma.user.findUnique({ where: { email: input.freelancerEmail as string } });
  if (!user) {
    throw new ValidationError([
      { field: "freelancerId", message: "No registered Freelancer matches that account." },
    ]);
  }
  return user;
}

/**
 * Requirements 3.1–3.3, 3.6, 3.7.
 * Duplicate PENDING/ACCEPTED invitations are rejected; a DECLINED invitation is
 * reset to PENDING so the Client can re-invite.
 */
export async function sendInvitation(clientId: string, input: SendInvitationInput): Promise<Invitation> {
  const brief = await prisma.brief.findUnique({ where: { id: input.briefId } });
  if (!brief) throw new NotFoundError("Brief");
  if (brief.clientId !== clientId) {
    throw new ForbiddenError("NOT_BRIEF_OWNER", "Only the owning Client may invite Freelancers.");
  }
  if (brief.status !== "OPEN") {
    throw new ConflictError("BRIEF_NOT_OPEN", "Invitations can only be sent for open Briefs.", brief.status);
  }

  const freelancer = await resolveFreelancer(input);
  if (freelancer.id === clientId) {
    throw new ValidationError([
      { field: "freelancerId", message: "You cannot invite yourself to your own Brief." },
    ]);
  }

  const existing = await prisma.invitation.findUnique({
    where: { briefId_freelancerId: { briefId: brief.id, freelancerId: freelancer.id } },
  });

  if (existing && (existing.status === "PENDING" || existing.status === "ACCEPTED")) {
    throw new ConflictError(
      "INVITATION_EXISTS",
      "An invitation for this Freelancer already exists for this Brief.",
      existing.status,
    );
  }

  const count = await prisma.invitation.count({ where: { briefId: brief.id } });
  if (!existing && count >= MAX_INVITATIONS_PER_BRIEF) {
    throw new ConflictError(
      "INVITATION_LIMIT_REACHED",
      `A Brief can have at most ${MAX_INVITATIONS_PER_BRIEF} invitations.`,
    );
  }

  return withTransaction(async (tx) => {
    let invitation: Invitation;
    if (existing) {
      // DECLINED (or previously REVOKED-into-DECLINED) invitation is reset.
      if (existing.status !== "DECLINED") {
        assertTransition(
          INVITATION_TRANSITIONS,
          existing.status,
          "PENDING",
          "INVITATION_NOT_REINVITABLE",
          "This invitation cannot be re-sent.",
        );
      }
      invitation = await tx.invitation.update({
        where: { id: existing.id },
        data: { status: "PENDING", token: randomUUID(), clientId },
      });
    } else {
      invitation = await tx.invitation.create({
        data: {
          briefId: brief.id,
          clientId,
          freelancerId: freelancer.id,
          token: randomUUID(),
          status: "PENDING",
        },
      });
    }

    await writeAuditLog(tx, {
      eventType: "INVITATION_SENT",
      actorId: clientId,
      resourceId: invitation.id,
      resourceType: "Invitation",
      previousState: existing?.status ?? null,
      newState: "PENDING",
      metadata: { briefId: brief.id, freelancerId: freelancer.id },
    });

    // Requirement 3.3 — in-platform notification to the invited Freelancer.
    await send(
      {
        userId: freelancer.id,
        type: "INVITATION_RECEIVED",
        payload: {
          invitationId: invitation.id,
          briefId: brief.id,
          briefTitle: brief.title,
          clientName: clientId,
          token: invitation.token,
        },
      },
      tx,
    );

    return invitation;
  });
}

export async function acceptInvitation(invitationId: string, freelancerId: string): Promise<Invitation> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitation");
  if (invitation.freelancerId !== freelancerId) {
    throw new ForbiddenError("NOT_INVITEE", "Only the invited Freelancer may respond to this invitation.");
  }
  assertTransition(
    INVITATION_TRANSITIONS,
    invitation.status,
    "ACCEPTED",
    "INVITATION_NOT_ACCEPTABLE",
    "This invitation can no longer be accepted.",
  );

  return withTransaction(async (tx) => {
    const updated = await tx.invitation.update({
      where: { id: invitationId },
      data: { status: "ACCEPTED" },
    });
    await writeAuditLog(tx, {
      eventType: "INVITATION_ACCEPTED",
      actorId: freelancerId,
      resourceId: invitationId,
      resourceType: "Invitation",
      previousState: invitation.status,
      newState: "ACCEPTED",
      metadata: { briefId: invitation.briefId },
    });
    return updated;
  });
}

/** Requirement 3.5 — declining a previously accepted invitation revokes read access. */
export async function declineInvitation(invitationId: string, freelancerId: string): Promise<Invitation> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitation");
  if (invitation.freelancerId !== freelancerId) {
    throw new ForbiddenError("NOT_INVITEE", "Only the invited Freelancer may respond to this invitation.");
  }
  assertTransition(
    INVITATION_TRANSITIONS,
    invitation.status,
    "DECLINED",
    "INVITATION_NOT_DECLINABLE",
    "This invitation can no longer be declined.",
  );

  const updated = await withTransaction(async (tx) => {
    const result = await tx.invitation.update({
      where: { id: invitationId },
      data: { status: "DECLINED" },
    });
    await writeAuditLog(tx, {
      eventType: "INVITATION_DECLINED",
      actorId: freelancerId,
      resourceId: invitationId,
      resourceType: "Invitation",
      previousState: invitation.status,
      newState: "DECLINED",
      metadata: { briefId: invitation.briefId },
    });
    return result;
  });

  // Requirement 23.5 — active signed URLs are invalidated within 5 seconds.
  await invalidateSignedUrlsForUser(freelancerId, { agreementScopedToBriefId: invitation.briefId });
  return updated;
}

/**
 * Requirement 3.8 — called when a Brief is closed or cancelled. Every PENDING
 * invitation becomes REVOKED and each Freelancer is notified.
 */
export async function revokeAllPendingInvitations(briefId: string, actorId: string): Promise<number> {
  const pending = await prisma.invitation.findMany({
    where: { briefId, status: "PENDING" },
  });
  if (pending.length === 0) return 0;

  return withTransaction(async (tx) => {
    let revoked = 0;
    for (const invitation of pending) {
      await tx.invitation.update({ where: { id: invitation.id }, data: { status: "REVOKED" } });
      await writeAuditLog(tx, {
        eventType: "INVITATION_REVOKED",
        actorId,
        resourceId: invitation.id,
        resourceType: "Invitation",
        previousState: "PENDING",
        newState: "REVOKED",
        metadata: { briefId },
      });
      await send(
        {
          userId: invitation.freelancerId,
          type: "INVITATION_REVOKED",
          payload: { invitationId: invitation.id, briefId },
        },
        tx,
      );
      revoked += 1;
    }
    return revoked;
  });
}

export async function listInvitationsForBrief(briefId: string) {
  return prisma.invitation.findMany({
    where: { briefId },
    include: { freelancer: { select: { id: true, displayName: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listInvitationsForFreelancer(freelancerId: string) {
  return prisma.invitation.findMany({
    where: { freelancerId },
    include: { brief: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function getInvitation(invitationId: string): Promise<Invitation> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new NotFoundError("Invitation");
  return invitation;
}

export async function notifyInvitationRevoked(
  tx: TxClient,
  invitation: Invitation,
): Promise<void> {
  await send(
    {
      userId: invitation.freelancerId,
      type: "INVITATION_REVOKED",
      payload: { invitationId: invitation.id, briefId: invitation.briefId },
    },
    tx,
  );
}
