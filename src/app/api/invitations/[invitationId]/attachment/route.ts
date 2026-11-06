import type { NextRequest } from "next/server";
import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getInvitationAttachment } from "@/lib/collaboration";

type Params = { params: Promise<{ invitationId: string }> };

/**
 * Requirement 22.5 — the attached collaboration context is only readable by the
 * invited Freelancer and only once the invitation has been accepted.
 */
export const GET = handler(async (_req: NextRequest, { params }: Params) => {
  const user = await requireSession();
  const { invitationId } = await params;
  const attachment = await getInvitationAttachment(invitationId, user.id);

  if (attachment.kind === "NONE") {
    return json({ kind: attachment.kind, message: attachment.message });
  }

  if (attachment.kind === "SUMMARY") {
    const summary = attachment.summary;
    return json({
      kind: attachment.kind,
      summaryId: summary.id,
      historyId: summary.historyId,
      content: summary.content,
      flaggedStatements: summary.flaggedStatements,
      generatedAt: summary.generatedAt.toISOString(),
    });
  }

  const history = attachment.history;
  return json({
    kind: attachment.kind,
    historyId: history.id,
    agreementId: history.agreementId,
    agreementSnapshot: history.agreementSnapshot,
    deliverables: history.deliverables,
    completedAt: history.completedAt.toISOString(),
    totalPaymentAmount: Number(history.totalPaymentAmount),
  });
});
