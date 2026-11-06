import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { assertBriefAccess } from "@/lib/access";
import { listInvitationsForBrief } from "@/lib/invitations";
import { listOwnQuotations, listQuotationsForBrief, quotationTotal } from "@/lib/quotations";
import { BriefLifecycleActions, InviteFreelancerForm } from "./brief-actions";
import { buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { asStringArray } from "@/lib/serializers";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

type Params = { params: Promise<{ briefId: string }> };

/** Normalised row so the Client and Freelancer queries render identically. */
type QuotationRow = {
  id: string;
  name: string;
  status: string;
  total: number;
  timelineDays: number;
  submittedAt: string | null;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { briefId } = await params;
  return { title: `Brief ${briefId.slice(0, 6)}` };
}

export default async function BriefDetailPage({ params }: Params) {
  const user = await requirePageSession();
  const { briefId } = await params;

  const context = await assertBriefAccess(briefId, user.id).catch(() => notFound());
  const { brief, role } = context;

  const isClient = role === "CLIENT";
  const invitations: Awaited<ReturnType<typeof listInvitationsForBrief>> = isClient
    ? await listInvitationsForBrief(briefId)
    : [];

  const quotationRows: QuotationRow[] = isClient
    ? (await listQuotationsForBrief(briefId, user.id)).map((quotation) => ({
        id: quotation.id,
        name: quotation.freelancer.displayName,
        status: quotation.status,
        total: quotationTotal(quotation.lineItems),
        timelineDays: quotation.timelineDays,
        submittedAt: quotation.submittedAt ? quotation.submittedAt.toISOString() : null,
      }))
    : (await listOwnQuotations(user.id, briefId)).map((quotation) => ({
        id: quotation.id,
        name: "You",
        status: quotation.status,
        total: quotationTotal(quotation.lineItems),
        timelineDays: quotation.timelineDays,
        submittedAt: quotation.submittedAt ? quotation.submittedAt.toISOString() : null,
      }));

  const deliverables = asStringArray(brief.deliverables);
  const submitted = quotationRows.filter((quotation) => quotation.submittedAt !== null);
  const canCompare = isClient && submitted.length >= 2;

  return (
    <div>
      <PageHeader
        eyebrow={`Brief · ${role === "CLIENT" ? "you are the client" : "you are a candidate"}`}
        title={brief.title}
        description={brief.description}
        meta={
          <>
            <StatusBadge status={brief.status} />
            <span className="text-xs text-muted">
              Budget <span className="font-medium text-foreground">{formatMoney(Number(brief.budgetMin))}</span> –{" "}
              <span className="font-medium text-foreground">{formatMoney(Number(brief.budgetMax))}</span>
            </span>
            <span className="text-xs text-muted">
              Target <span className="font-medium text-foreground">{formatDate(brief.targetDate)}</span>
            </span>
            {brief.publishedAt ? (
              <span className="text-xs text-muted">Published {formatDateTime(brief.publishedAt)}</span>
            ) : null}
          </>
        }
        actions={isClient ? <BriefLifecycleActions briefId={brief.id} status={brief.status} /> : null}
      />

      {canCompare ? (
        <Card className="mb-5 border-primary/30 bg-primary-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">{submitted.length} quotations ready to compare</p>
              <p className="mt-0.5 text-xs text-primary/80">
                Line items are aligned by description so the difference is visible, not inferred.
              </p>
            </div>
            <Link href={`/briefs/${brief.id}/compare`} className={buttonClass("primary", "sm")}>
              Open comparison workspace
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Deliverables" description="The checklist a delivery is judged against." />
            <CardBody>
              <ol className="space-y-2">
                {deliverables.map((deliverable, index) => (
                  <li key={`${deliverable}-${index}`} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed">{deliverable}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Quotations"
              description={
                isClient
                  ? "Ordered by submission time. Every bid is measured against the brief above."
                  : "Your own quotations for this brief."
              }
              actions={
                isClient ? (
                  <Link href={`/briefs/${brief.id}/quotations`} className={buttonClass("secondary", "sm")}>
                    All quotations
                  </Link>
                ) : null
              }
            />
            <CardBody>
              {quotationRows.length === 0 ? (
                <EmptyState
                  title="No quotations yet"
                  description={
                    isClient
                      ? "Invite a freelancer below. They draft a quotation, you compare it, and only then does an agreement exist."
                      : "You have not quoted on this brief. Start a draft to propose your price and timeline."
                  }
                  action={
                    !isClient ? (
                      <Link
                        href={`/quotations/new?briefId=${brief.id}`}
                        className={buttonClass("primary", "sm")}
                      >
                        Draft a quotation
                      </Link>
                    ) : null
                  }
                />
              ) : (
                <ul className="divide-y divide-border-base">
                  {quotationRows.map((quotation) => (
                    <li
                      key={quotation.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{quotation.name}</p>
                          <StatusBadge status={quotation.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatMoney(quotation.total)} · {quotation.timelineDays} days ·{" "}
                          {quotation.submittedAt
                            ? `submitted ${formatDateTime(quotation.submittedAt)}`
                            : "not submitted"}
                        </p>
                      </div>
                      <Link href={`/quotations/${quotation.id}`} className={buttonClass("ghost", "sm")}>
                        View
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {isClient ? (
            <Card>
              <CardHeader title="Invitations" description={`${invitations.length} sent`} />
              <CardBody className="space-y-4">
                <InviteFreelancerForm briefId={brief.id} />
                {invitations.length === 0 ? (
                  <p className="text-xs text-muted">Nobody has been invited yet.</p>
                ) : (
                  <ul className="space-y-2 border-t border-border-base pt-3">
                    {invitations.map((invitation) => (
                      <li key={invitation.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">
                          {invitation.freelancer.displayName}
                          <span className="ml-1 text-muted">{invitation.freelancer.email}</span>
                        </span>
                        <StatusBadge status={invitation.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Your position" />
              <CardBody className="space-y-2 text-sm">
                <p className="text-muted">
                  You were invited to this brief. Your quotation is private until you submit it — the client sees
                  submitted quotations only.
                </p>
                <Link
                  href={`/quotations/new?briefId=${brief.id}`}
                  className={buttonClass("primary", "sm", "w-full")}
                >
                  {quotationRows.length > 0 ? "Continue your draft" : "Start a quotation"}
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
