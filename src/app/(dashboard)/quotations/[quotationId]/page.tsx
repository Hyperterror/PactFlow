import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getQuotationForViewer, quotationTotal } from "@/lib/quotations";
import { COMMENTABLE_STATUSES, COMMENT_EDIT_WINDOW_MS, listComments } from "@/lib/quotations/comments";
import { Badge, buttonClass, Card, CardBody, CardHeader, KeyValue, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CommentThread } from "@/components/comment-thread";
import { QuotationStatusWatcher } from "@/components/quotation-status-watcher";
import { QuotationActions } from "./quotation-actions";

type Params = { params: Promise<{ quotationId: string }> };

export const metadata: Metadata = { title: "Quotation" };

interface LineItem {
  description?: string;
  price?: number;
  aiSourced?: boolean;
  pricingConfidence?: string;
  rationale?: string;
}

/**
 * Requirements 6.2 / 6.4 / 7.x — line items, timeline, notes, the submission
 * timestamp in UTC and the Freelancer display name, plus the discussion thread.
 */
export default async function QuotationPage({ params }: Params) {
  const user = await requirePageSession();
  const { quotationId } = await params;

  const { quotation, viewerRole } = await getQuotationForViewer(quotationId, user.id).catch(() => notFound());
  const thread: Awaited<ReturnType<typeof listComments>> = await listComments(quotationId, user.id).catch(() => ({
    comments: [],
    openClarifications: 0,
  }));

  const lineItems = Array.isArray(quotation.lineItems) ? (quotation.lineItems as unknown as LineItem[]) : [];
  const total = quotationTotal(quotation.lineItems);
  const aiSourcedFields = Array.isArray(quotation.aiSourcedFields)
    ? (quotation.aiSourcedFields as unknown[]).filter((value): value is number => typeof value === "number")
    : [];
  const canComment = (COMMENTABLE_STATUSES as string[]).includes(quotation.status);

  return (
    <div className="space-y-5">
      <QuotationStatusWatcher quotationId={quotationId} status={quotation.status} />

      <PageHeader
        eyebrow="Quotation"
        title={quotation.brief.title}
        description={`Submitted by ${quotation.freelancer.displayName}. Line items are the Freelancer's own numbers; the pricing advice is not binding.`}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={quotation.status} />
            <span>{lineItems.length} line items</span>
            <span>{quotation.timelineDays} days</span>
            <span>Submitted {formatDateTime(quotation.submittedAt)}</span>
          </div>
        }
        actions={
          <Link href={`/briefs/${quotation.briefId}`} className={buttonClass("secondary", "md")}>
            Brief
          </Link>
        }
      />

      <QuotationActions
        quotationId={quotationId}
        briefId={quotation.briefId}
        status={quotation.status}
        viewerRole={viewerRole}
      />

      <Card>
        <CardHeader
          title="Line items"
          description="Prices are fixed once the quotation is submitted; a change after that is a new quotation."
          actions={<span className="text-sm font-semibold">Total {formatMoney(total)}</span>}
        />
        <CardBody>
          {lineItems.length === 0 ? (
            <p className="text-sm text-muted">No line items yet.</p>
          ) : (
            <ul className="divide-y divide-border-base">
              {lineItems.map((item, index) => (
                <li key={index} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm">{item.description || "Untitled line item"}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {aiSourcedFields.includes(index) ? <Badge tone="info">AI-suggested price accepted</Badge> : null}
                        {item.pricingConfidence ? (
                          <span className="text-xs text-muted">
                            {item.pricingConfidence.toLowerCase()} confidence
                            {item.rationale ? ` · ${item.rationale}` : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-medium">{formatMoney(item.price ?? 0)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Notes" description="Assumptions and conditions the Freelancer attached." />
          <CardBody>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{quotation.notes}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-3">
            <KeyValue label="Freelancer">{quotation.freelancer.displayName}</KeyValue>
            <KeyValue label="Timeline">{quotation.timelineDays} days</KeyValue>
            <KeyValue label="Total">{formatMoney(total)}</KeyValue>
            <KeyValue label="Submitted">{formatDateTime(quotation.submittedAt)}</KeyValue>
            <KeyValue label="Created">{formatDateTime(quotation.createdAt)}</KeyValue>
            <KeyValue label="Regenerations">{quotation.regenerationCount}</KeyValue>
            <KeyValue label="Your role">{viewerRole === "CLIENT" ? "Client" : "Freelancer"}</KeyValue>
          </CardBody>
        </Card>
      </div>

      <CommentThread
        quotationId={quotationId}
        viewerId={user.id}
        initialComments={thread.comments.map((comment) => ({
          ...comment,
          createdAt: comment.createdAt.toISOString(),
          editedAt: comment.editedAt?.toISOString() ?? null,
        }))}
        initialOpenClarifications={thread.openClarifications}
        canComment={canComment}
        editWindowMs={COMMENT_EDIT_WINDOW_MS}
      />
    </div>
  );
}
