import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getAgreement } from "@/lib/agreements";
import { assertAgreementParticipant } from "@/lib/access";
import { listMessages } from "@/lib/change-requests/discussion";
import { listChangeRequests } from "@/lib/change-requests";
import { readStoredEvidence } from "@/lib/ai/scope-baseline";
import { buttonClass, PageHeader, StatusBadge } from "@/components/ui";
import { DiscussionRoom, type FeedMessage, type ProposalRow } from "./discussion-room";

type Params = { params: Promise<{ agreementId: string }> };

export const metadata: Metadata = { title: "Discussion" };

/**
 * Requirements 10.5 / 11.3 — the message feed carries the scope-change badge and
 * links to the proposal, where the votes and the AI label live.
 */
export default async function DiscussionPage({ params }: Params) {
  const user = await requirePageSession();
  const { agreementId } = await params;

  const context = await assertAgreementParticipant(agreementId, user.id).catch(() => notFound());
  const messagesResult = await listMessages(agreementId, user.id);
  const proposals = await listChangeRequests(agreementId, user.id);
  const agreement = await getAgreement(agreementId);

  const feed: FeedMessage[] = messagesResult.messages.map((message) => ({
    id: message.id,
    authorId: message.authorId,
    authorName: message.authorName,
    authorRole: message.authorRole,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    isScopeProposal: message.isScopeProposal,
    badge: message.badge,
    changeRequestId: message.changeRequestId,
  }));

  const rows: ProposalRow[] = proposals.map((proposal) => ({
    id: proposal.id,
    status: proposal.status,
    scopeLabel: proposal.scopeLabel,
    scopeRationale: proposal.scopeRationale,
    scopeEvidence: readStoredEvidence(proposal.scopeEvidence),
    scopeBaseline: proposal.scopeBaseline,
    responseDeadline: proposal.responseDeadline.toISOString(),
    reminderSentAt: proposal.reminderSentAt?.toISOString() ?? null,
    submitterId: proposal.submitterId,
    proposal: proposal.discussionMessage.content,
    createdAt: proposal.createdAt.toISOString(),
    votes: proposal.votes.map((vote) => ({
      actorId: vote.actorId,
      actorRole: vote.actorRole,
      vote: vote.vote,
      createdAt: vote.createdAt.toISOString(),
      retractedAt: vote.retractedAt?.toISOString() ?? null,
    })),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Discussion"
        title="Project discussion"
        description="Scope changes start as proposals here. Two approvals create a new version; one rejection leaves the agreement untouched."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={agreement.status} />
            <span>Version {agreement.currentVersion}</span>
            <span>You are the {context.role === "CLIENT" ? "Client" : "Freelancer"}</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/agreements/${agreementId}`} className={buttonClass("secondary", "md")}>
              Agreement
            </Link>
            <Link href={`/delivery?agreementId=${agreementId}`} className={buttonClass("ghost", "md")}>
              Delivery
            </Link>
          </div>
        }
      />

      <DiscussionRoom
        agreementId={agreementId}
        viewerId={user.id}
        discussionOpen={agreement.status === "ACTIVE"}
        initialMessages={feed}
        initialProposals={rows}
      />
    </div>
  );
}
