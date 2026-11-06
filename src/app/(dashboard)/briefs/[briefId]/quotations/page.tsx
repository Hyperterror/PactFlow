import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { assertBriefOwner } from "@/lib/access";
import { listQuotationsForBrief, quotationTotal } from "@/lib/quotations";
import { buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/format";

type Params = { params: Promise<{ briefId: string }> };

export const metadata: Metadata = { title: "Quotations" };

/**
 * Requirement 6.1 — quotations are listed in submission order (oldest first) so
 * the Client reviews them in the order they arrived.
 */
export default async function BriefQuotationsPage({ params }: Params) {
  const user = await requirePageSession();
  const { briefId } = await params;

  const context = await assertBriefOwner(briefId, user.id).catch(() => notFound());
  const quotations = await listQuotationsForBrief(briefId, user.id);

  return (
    <div>
      <PageHeader
        eyebrow="Quotations"
        title={context.title}
        description="Ordered by submission time. Shortlist the bids worth comparing, then open the workspace to align them line by line."
        actions={
          <div className="flex gap-2">
            <Link href={`/briefs/${briefId}`} className={buttonClass("secondary", "md")}>
              Brief
            </Link>
            <Link href={`/briefs/${briefId}/compare`} className={buttonClass("primary", "md")}>
              Compare
            </Link>
          </div>
        }
      />

      {quotations.length === 0 ? (
        <EmptyState
          title="No submitted quotations"
          description="Quotations appear here once a freelancer submits one. Drafts stay private to them."
          action={
            <Link href={`/briefs/${briefId}`} className={buttonClass("secondary", "md")}>
              Invite a freelancer
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {quotations.map((quotation) => (
            <Card key={quotation.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {quotation.freelancer.displayName}
                    <StatusBadge status={quotation.status} />
                  </span>
                }
                description={`${quotation.lineItems ? quotationTotal(quotation.lineItems).toFixed(2) : "0.00"} total · ${
                  quotation.timelineDays
                } days · submitted ${formatDateTime(quotation.submittedAt)}`}
                actions={
                  <Link href={`/quotations/${quotation.id}`} className={buttonClass("secondary", "sm")}>
                    Open
                  </Link>
                }
              />
              <CardBody>
                <ul className="divide-y divide-border-base">
                  {(quotation.lineItems as Array<{ description: string; price: number }>).map((item, index) => (
                    <li key={index} className="flex items-center justify-between gap-4 py-1.5 text-sm first:pt-0 last:pb-0">
                      <span className="min-w-0 truncate">{item.description}</span>
                      <span className="shrink-0 font-medium">{formatMoney(item.price)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-border-base pt-3 text-sm leading-relaxed text-muted">
                  {quotation.notes}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
