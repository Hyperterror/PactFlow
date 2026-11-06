import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { SubmitChangeRequestSchema, listChangeRequests, submitChangeRequest } from "@/lib/change-requests";

type Params = { params: Promise<{ agreementId: string }> };

/** Requirement 11.3 — both parties see every change request on the Agreement. */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const changeRequests = await listChangeRequests(agreementId, user.id);

  return json({
    changeRequests: changeRequests.map((changeRequest) => ({
      id: changeRequest.id,
      agreementId: changeRequest.agreementId,
      status: changeRequest.status,
      scopeLabel: changeRequest.scopeLabel,
      scopeRationale: changeRequest.scopeRationale,
      responseDeadline: changeRequest.responseDeadline.toISOString(),
      reminderSentAt: changeRequest.reminderSentAt?.toISOString() ?? null,
      submitterId: changeRequest.submitterId,
      proposal: changeRequest.discussionMessage.content,
      createdAt: changeRequest.createdAt.toISOString(),
      votes: changeRequest.votes.map((vote) => ({
        actorId: vote.actorId,
        actorRole: vote.actorRole,
        vote: vote.vote,
        createdAt: vote.createdAt.toISOString(),
        retractedAt: vote.retractedAt?.toISOString() ?? null,
      })),
    })),
  });
});

/**
 * Requirements 12.1 / 12.8 / 11.1 — submits the proposal, writes the tagged
 * discussion message in the same transaction and starts the AI classification.
 */
export const POST = handler(async (req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { agreementId } = await params;
  const input = await parseJson(req, SubmitChangeRequestSchema);
  const result = await submitChangeRequest(agreementId, user.id, input);

  return json(
    {
      changeRequest: {
        id: result.changeRequest.id,
        agreementId: result.changeRequest.agreementId,
        status: result.changeRequest.status,
        scopeLabel: result.changeRequest.scopeLabel,
        responseDeadline: result.changeRequest.responseDeadline.toISOString(),
        submitterId: result.changeRequest.submitterId,
        createdAt: result.changeRequest.createdAt.toISOString(),
      },
      scopeLabel: result.scopeLabel,
      scopeRationale: result.scopeRationale,
      classificationTimedOut: result.classificationTimedOut,
    },
    201,
  );
});
