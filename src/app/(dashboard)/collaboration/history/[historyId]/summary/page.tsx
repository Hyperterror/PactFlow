import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import {
  SUMMARY_CACHE_HOURS,
  getHistoryForParticipant,
  getLatestSummaryForHistory,
} from "@/lib/collaboration";
import { Badge, buttonClass, Card, CardBody, CardHeader, KeyValue, PageHeader } from "@/components/ui";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { SummaryPanel, type StoredSummaryView } from "./summary-panel";

export const metadata: Metadata = { title: "Collaboration summary" };

/**
 * Requirement 21.1-21.6 — the page renders whatever is already stored so the route
 * is never blocked on the AI call; generating or regenerating happens from the
 * panel, which talks to `POST /api/collaboration/history/[historyId]/summary`.
 *
 * The literal `history/` segment is load-bearing: Next.js refuses a route tree in
 * which two sibling dynamic folders use different slug names, and this page would
 * otherwise sit alongside `[clientId]/[freelancerId]` under `/collaboration`.
 */
export default async function CollaborationSummaryPage({
  params,
}: {
  params: Promise<{ historyId: string }>;
}) {
  const { historyId } = await params;
  const user = await requirePageSession();

  const history = await getHistoryForParticipant(historyId, user.id).catch(() => notFound());
  const stored = await getLatestSummaryForHistory(historyId, user.id);

  const initial: StoredSummaryView | null = stored
    ? {
        id: stored.id,
        generatedAt: stored.generatedAt.toISOString(),
        content: stored.content,
        flaggedStatements: stored.flaggedStatements.map((flag) => ({
          statementIndex: flag.statementIndex,
          flaggedByUserId: flag.flaggedByUserId,
          flaggedAt: flag.flaggedAt,
          reason: flag.reason,
        })),
      }
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Collaboration history"
        title="Collaboration summary"
        description={`What you and ${history.counterpartName} delivered on "${history.briefTitle}", written only from the records of that project.`}
        meta={
          <>
            <Badge tone="info">{formatDate(history.completedAt)}</Badge>
            <span className="text-xs text-muted">
              {history.deliverableCount} deliverable{history.deliverableCount === 1 ? "" : "s"} ·{" "}
              {formatMoney(history.totalPaymentAmount)}
            </span>
          </>
        }
        actions={
          <Link
            href={`/collaboration/${history.clientId}/${history.freelancerId}`}
            className={buttonClass("ghost", "sm")}
          >
            Back to history
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SummaryPanel
          historyId={historyId}
          agreementId={history.agreementId}
          viewerId={user.id}
          cacheWindowHours={SUMMARY_CACHE_HOURS}
          initial={initial}
        />

        <div className="space-y-4">
          <Card>
            <CardHeader title="Grounded in" description="The only records this summary may cite." />
            <CardBody>
              <dl className="divide-y divide-border-base">
                <KeyValue label="Project">{history.briefTitle}</KeyValue>
                <KeyValue label="Completed">{formatDate(history.completedAt)}</KeyValue>
                <KeyValue label="Total paid">{formatMoney(history.totalPaymentAmount)}</KeyValue>
                <KeyValue label="Deliverables">{history.deliverableCount}</KeyValue>
                <KeyValue label="Counterpart">{history.counterpartName}</KeyValue>
              </dl>
              <Link
                href={`/agreements/${history.agreementId}`}
                className={buttonClass("secondary", "sm", "mt-4 w-full")}
              >
                Open the agreement
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="How this works" />
            <CardBody>
              <ul className="space-y-2 text-xs leading-relaxed text-muted">
                <li>
                  Statements come only from the completed agreement, its approved deliverables and the working
                  preferences both parties confirmed.
                </li>
                <li>
                  A cached summary is reused for {SUMMARY_CACHE_HOURS} hours; regenerating is an explicit
                  choice, never automatic.
                </li>
                <li>
                  Flagging a statement records who flagged it and when. It never rewrites the underlying
                  collaboration history.
                </li>
                <li>If there is not enough completed work, you get an explicit notice instead of a guess.</li>
              </ul>
              {stored ? (
                <p className="mt-3 text-xs text-muted">
                  Latest version stored {formatDateTime(stored.generatedAt)}.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
