"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Alert,
  Badge,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  inputClass,
  textareaClass,
} from "@/components/ui";
import { apiRequest, errorMessage } from "@/lib/api-client";
import { formatDateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useServerRefresh } from "@/lib/use-server-refresh";

export interface FeedMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  isScopeProposal: boolean;
  badge: string | null;
  changeRequestId: string | null;
}

export interface ProposalVote {
  actorId: string;
  actorRole: string;
  vote: string;
  createdAt: string;
  retractedAt: string | null;
}

export interface ProposalRow {
  id: string;
  status: string;
  scopeLabel: string | null;
  scopeRationale: string | null;
  scopeEvidence: Array<{ ref: string; relation: string; text: string; matchedTerms: string[] }>;
  scopeBaseline: string | null;
  responseDeadline: string;
  reminderSentAt: string | null;
  submitterId: string;
  proposal: string;
  createdAt: string;
  votes: ProposalVote[];
}

const EVIDENCE_LABELS: Record<string, string> = {
  COVERED_BY: "covers this",
  EXCLUDED_BY: "explicitly excludes this",
  PARTIALLY_COVERED_BY: "partly covers this",
  NEAREST_TERM: "closest item checked",
};

const MAX_DEADLINE_DAYS = 30;
const MIN_DEADLINE_DAYS = 1;

function scopeTone(label: string | null) {
  if (label === "INCLUDED") return "success" as const;
  if (label === "OUTSIDE_SCOPE") return "danger" as const;
  if (label === "AMBIGUOUS") return "warning" as const;
  return "neutral" as const;
}

/**
 * Requirements 10.1–10.6 / 11.1–11.6 / 12.1–12.9 — the project discussion, the
 * scope-change proposals it can spawn, and the dual vote that turns an approved
 * proposal into a new agreement version. The AI label is advisory; only the two
 * votes change anything.
 */
export function DiscussionRoom({
  agreementId,
  viewerId,
  discussionOpen,
  initialMessages,
  initialProposals,
}: {
  agreementId: string;
  viewerId: string;
  discussionOpen: boolean;
  initialMessages: FeedMessage[];
  initialProposals: ProposalRow[];
}) {
  const refresh = useServerRefresh();
  const [messages, setMessages] = useState<FeedMessage[]>(initialMessages);
  const [proposals, setProposals] = useState<ProposalRow[]>(initialProposals);
  const [draft, setDraft] = useState("");
  const [tagAsProposal, setTagAsProposal] = useState(false);
  const [proposalDraft, setProposalDraft] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("7");
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [messageData, proposalData] = await Promise.all([
      apiRequest<{ messages: FeedMessage[] }>(`/api/agreements/${agreementId}/messages`),
      apiRequest<{ changeRequests: ProposalRow[] }>(`/api/agreements/${agreementId}/change-requests`),
    ]);
    setMessages(messageData.messages);
    setProposals(proposalData.changeRequests);
    refresh();
  }

  async function run(label: string, path: string, body?: unknown, after?: () => void) {
    setBusy(label);
    setError(null);
    try {
      await apiRequest(path, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      after?.();
      await reload();
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(null);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (content.length === 0) return;
    if (tagAsProposal) {
      await run(
        "message",
        `/api/agreements/${agreementId}/change-requests`,
        { content, deadlineDays: Number(deadlineDays) },
        () => {
          setDraft("");
          setTagAsProposal(false);
        },
      );
    } else {
      await run("message", `/api/agreements/${agreementId}/messages`, { content }, () => setDraft(""));
    }
  }

  async function submitProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = proposalDraft.trim();
    if (content.length === 0) return;
    await run(
      "proposal",
      `/api/agreements/${agreementId}/change-requests`,
      { content, deadlineDays: Number(deadlineDays) },
      () => {
        setProposalDraft("");
        setShowProposalForm(false);
      },
    );
  }

  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!discussionOpen ? (
        <Alert tone="info">
          The discussion opens when the agreement is active. It stays readable, but new messages are closed.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="flex flex-col">
          <CardHeader
            title="Discussion"
            description="Everything the two of you say about this project, in order."
            actions={<Badge tone={messages.length > 0 ? "neutral" : "neutral"}>{messages.length} messages</Badge>}
          />
          <CardBody className="flex-1 space-y-4">
            {messages.length === 0 ? (
              <EmptyState title="No messages yet" description="Say hello, or raise the first scope question." />
            ) : (
              <ul className="space-y-3">
                {messages.map((message) => {
                  const mine = message.authorId === viewerId;
                  return (
                    <li
                      key={message.id}
                      className={cn(
                        "rounded-lg border p-3",
                        mine ? "border-border-strong bg-surface-muted" : "border-border-base",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold">{message.authorName}</span>
                        <Badge tone={message.authorRole === "CLIENT" ? "info" : "neutral"}>
                          {humanize(message.authorRole)}
                        </Badge>
                        {message.isScopeProposal ? <Badge tone="warning">Scope Change Proposal</Badge> : null}
                        <span className="text-xs text-muted">{formatDateTime(message.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                      {message.changeRequestId ? (
                        <a
                          href={`#proposal-${message.changeRequestId}`}
                          className="mt-1 inline-block text-xs font-medium text-primary underline"
                        >
                          View proposal
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {discussionOpen ? (
              <form onSubmit={sendMessage} className="space-y-2 border-t border-border-base pt-4">
                <textarea
                  className={textareaClass}
                  rows={3}
                  maxLength={5000}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Write a message…"
                  aria-label="New message"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={tagAsProposal}
                      onChange={(event) => setTagAsProposal(event.target.checked)}
                      className="rounded border-border-strong accent-primary"
                    />
                    Tag as scope-change proposal
                  </label>
                  {tagAsProposal ? (
                    <label className="flex items-center gap-2 text-xs text-muted">
                      Response window (days)
                      <input
                        className={cn(inputClass, "h-8 w-20 px-2 text-xs")}
                        type="number"
                        min={MIN_DEADLINE_DAYS}
                        max={MAX_DEADLINE_DAYS}
                        value={deadlineDays}
                        onChange={(event) => setDeadlineDays(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    type="submit"
                    className={buttonClass("primary", "sm")}
                    disabled={busy !== null || draft.trim().length === 0}
                  >
                    {busy === "message" ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Scope change proposals"
              description="A proposal needs both votes. One approval never changes the agreement."
              actions={
                discussionOpen ? (
                  <button
                    type="button"
                    className={buttonClass("secondary", "sm")}
                    onClick={() => setShowProposalForm((open) => !open)}
                  >
                    {showProposalForm ? "Cancel" : "Propose"}
                  </button>
                ) : null
              }
            />
            <CardBody className="space-y-3">
              {showProposalForm ? (
                <form onSubmit={submitProposal} className="space-y-2 rounded-lg border border-border-base p-3">
                  <textarea
                    className={textareaClass}
                    rows={3}
                    maxLength={5000}
                    value={proposalDraft}
                    onChange={(event) => setProposalDraft(event.target.value)}
                    placeholder="Describe the change and why it is needed…"
                    aria-label="Proposal text"
                  />
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Response window (days)
                    <input
                      className={cn(inputClass, "h-8 w-20 px-2 text-xs")}
                      type="number"
                      min={MIN_DEADLINE_DAYS}
                      max={MAX_DEADLINE_DAYS}
                      value={deadlineDays}
                      onChange={(event) => setDeadlineDays(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className={buttonClass("primary", "sm")}
                    disabled={busy !== null || proposalDraft.trim().length === 0}
                  >
                    {busy === "proposal" ? "Submitting…" : "Submit proposal"}
                  </button>
                </form>
              ) : null}

              {proposals.length === 0 ? (
                <p className="text-sm text-muted">No proposals on this agreement.</p>
              ) : (
                <ul className="space-y-3">
                  {proposals.map((proposal) => {
                    const activeVotes = proposal.votes.filter((vote) => vote.retractedAt === null);
                    const myVote = activeVotes.find((vote) => vote.actorId === viewerId);
                    const closed = proposal.status !== "SUBMITTED";
                    const isSubmitter = proposal.submitterId === viewerId;
                    return (
                      <li
                        key={proposal.id}
                        id={`proposal-${proposal.id}`}
                        className="scroll-mt-6 rounded-lg border border-border-base p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={scopeTone(proposal.scopeLabel)}>
                            {proposal.scopeLabel ? humanize(proposal.scopeLabel) : "Unclassified"}
                          </Badge>
                          <Badge tone={proposal.status === "SUBMITTED" ? "warning" : "neutral"}>
                            {humanize(proposal.status)}
                          </Badge>
                          <span className="text-xs text-muted">due {formatDateTime(proposal.responseDeadline)}</span>
                        </div>

                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{proposal.proposal}</p>

                        {proposal.scopeRationale ? (
                          <div className="mt-2 rounded-md bg-surface-muted px-2 py-1.5 text-xs leading-relaxed text-muted">
                            <p>
                              <span className="font-semibold">AI classification (advisory)</span>
                              {proposal.scopeBaseline ? ` · judged against ${proposal.scopeBaseline}` : ""}:{" "}
                              {proposal.scopeRationale}
                            </p>
                            {proposal.scopeEvidence.length > 0 ? (
                              <ul className="mt-1.5 space-y-1" aria-label="Evidence">
                                {proposal.scopeEvidence.map((entry) => (
                                  <li key={`${entry.relation}-${entry.ref}`}>
                                    <span className="font-mono font-semibold text-foreground">{entry.ref}</span>{" "}
                                    <span className="font-medium">{EVIDENCE_LABELS[entry.relation] ?? humanize(entry.relation)}</span>
                                    {entry.text ? <> — {entry.text}</> : null}
                                    {entry.matchedTerms.length > 0 ? (
                                      <span className="block text-[11px]">matched: {entry.matchedTerms.join(", ")}</span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}

                        <ul className="mt-2 space-y-1 text-xs">
                          {(["CLIENT", "FREELANCER"] as const).map((role) => {
                            const vote = activeVotes.find((candidate) => candidate.actorRole === role);
                            return (
                              <li key={role} className="flex items-center justify-between gap-2">
                                <span className="text-muted">{humanize(role)}</span>
                                <span
                                  className={cn(
                                    "font-medium",
                                    vote?.vote === "APPROVE" && "text-success",
                                    vote?.vote === "REJECT" && "text-danger",
                                    !vote && "text-warning",
                                  )}
                                >
                                  {vote ? humanize(vote.vote) : "Not voted"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>

                        {!closed ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {myVote ? (
                              <button
                                type="button"
                                className={buttonClass("ghost", "sm")}
                                disabled={busy !== null}
                                onClick={() =>
                                  void run(
                                    `retract-${proposal.id}`,
                                    `/api/agreements/${agreementId}/change-requests/${proposal.id}/retract`,
                                  )
                                }
                              >
                                Retract my vote
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className={buttonClass("success", "sm")}
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void run(
                                      `approve-${proposal.id}`,
                                      `/api/agreements/${agreementId}/change-requests/${proposal.id}/vote`,
                                      { vote: "APPROVE" },
                                    )
                                  }
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className={buttonClass("danger", "sm")}
                                  disabled={busy !== null}
                                  onClick={() =>
                                    void run(
                                      `reject-${proposal.id}`,
                                      `/api/agreements/${agreementId}/change-requests/${proposal.id}/vote`,
                                      { vote: "REJECT" },
                                    )
                                  }
                                >
                                  Reject
                                </button>
                              </>
                            )}

                            {isSubmitter ? (
                              <button
                                type="button"
                                className={buttonClass("ghost", "sm")}
                                disabled={busy !== null}
                                onClick={() =>
                                  void run(
                                    `withdraw-${proposal.id}`,
                                    `/api/agreements/${agreementId}/change-requests/${proposal.id}/withdraw`,
                                  )
                                }
                              >
                                Withdraw
                              </button>
                            ) : null}

                            <button
                              type="button"
                              className={buttonClass("ghost", "sm")}
                              disabled={busy !== null}
                              onClick={() =>
                                void run(
                                  `reclassify-${proposal.id}`,
                                  `/api/agreements/${agreementId}/change-requests/${proposal.id}/reclassify`,
                                )
                              }
                            >
                              Re-run classification
                            </button>

                            <button
                              type="button"
                              className={buttonClass("ghost", "sm")}
                              disabled={busy !== null}
                              onClick={() => {
                                setDisputing(disputing === proposal.id ? null : proposal.id);
                                setJustification("");
                              }}
                            >
                              Dispute label
                            </button>
                          </div>
                        ) : null}

                        {disputing === proposal.id ? (
                          <div className="mt-2 space-y-2">
                            <textarea
                              className={textareaClass}
                              rows={2}
                              value={justification}
                              onChange={(event) => setJustification(event.target.value)}
                              placeholder="Why is the AI label wrong?"
                              aria-label="Dispute justification"
                            />
                            <button
                              type="button"
                              className={buttonClass("secondary", "sm")}
                              disabled={busy !== null || justification.trim().length === 0}
                              onClick={() =>
                                void run(
                                  `dispute-${proposal.id}`,
                                  `/api/agreements/${agreementId}/change-requests/${proposal.id}/dispute`,
                                  { justification: justification.trim() },
                                  () => {
                                    setDisputing(null);
                                    setJustification("");
                                  },
                                )
                              }
                            >
                              Submit dispute
                            </button>
                          </div>
                        ) : null}

                        <details className="mt-3">
                          <summary className={cn(buttonClass("ghost", "sm"), "cursor-pointer list-none text-xs")}>
                            Audit trail ({proposal.votes.length} vote{proposal.votes.length !== 1 ? "s" : ""})
                          </summary>
                          {proposal.votes.length === 0 ? (
                            <p className="mt-2 text-xs text-muted">No votes recorded.</p>
                          ) : (
                            <ul className="mt-2 space-y-1.5">
                              {proposal.votes.map((vote, voteIndex) => (
                                <li
                                  key={voteIndex}
                                  className={cn(
                                    "rounded-md border px-2 py-1.5 text-xs",
                                    vote.retractedAt
                                      ? "border-border-base text-muted line-through"
                                      : "border-border-strong",
                                  )}
                                >
                                  <span className="font-semibold">{humanize(vote.actorRole)}</span>
                                  {" — "}
                                  <span
                                    className={cn(
                                      vote.vote === "APPROVE" && "text-success",
                                      vote.vote === "REJECT" && "text-danger",
                                    )}
                                  >
                                    {humanize(vote.vote)}
                                  </span>
                                  {" · "}
                                  <span title={vote.createdAt}>{formatDateTime(vote.createdAt)}</span>
                                  {vote.retractedAt ? (
                                    <>
                                      {" "}
                                      <span className="text-muted">(retracted {formatDateTime(vote.retractedAt)})</span>
                                    </>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Agreement" description="Jump back to the versioned terms." />
            <CardBody>
              <Link href={`/agreements/${agreementId}`} className={buttonClass("secondary", "sm")}>
                Open agreement
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
