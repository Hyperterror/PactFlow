import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { listAgreementSummaries } from "@/lib/agreements";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Agreements" };

/**
 * Requirement 9.1 — the agreement is the single source of truth once a
 * quotation is accepted. This index groups them by what the viewer must do.
 */
export default async function AgreementsPage() {
  const user = await requirePageSession();
  const agreements = await listAgreementSummaries(user.id);

  const awaitingApproval = agreements.filter((agreement) => agreement.status === "PENDING_APPROVAL");
  const active = agreements.filter((agreement) => agreement.status === "ACTIVE");
  const closed = agreements.filter(
    (agreement) => agreement.status === "COMPLETED" || agreement.status === "CANCELLED",
  );

  function section(title: string, description: string, rows: typeof agreements) {
    if (rows.length === 0) return null;
    return (
      <Card>
        <CardHeader title={title} description={description} />
        <CardBody>
          <ul className="divide-y divide-border-base">
            {rows.map((agreement) => (
              <li key={agreement.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {agreement.brief.title}
                    <StatusBadge status={agreement.status} />
                    <Badge tone={agreement.role === "CLIENT" ? "info" : "neutral"}>
                      {agreement.role === "CLIENT" ? "You hired" : "You were hired"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {agreement.counterpartName} · version {agreement.currentVersion} ·{" "}
                    {agreement.approvedMilestones}/{agreement.milestoneCount} milestones approved · created{" "}
                    {formatDate(agreement.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/agreements/${agreement.id}`} className={buttonClass("secondary", "sm")}>
                    Open
                  </Link>
                  <Link href={`/agreements/${agreement.id}/discussion`} className={buttonClass("ghost", "sm")}>
                    Discussion
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Agreements"
        title="Agreements"
        description="Each agreement is a versioned record both parties approved. A change after approval is a new version, never an edit."
      />

      {agreements.length === 0 ? (
        <EmptyState
          title="No agreements yet"
          description="Accepting a quotation creates the agreement and its first version."
          action={
            <Link href="/briefs" className={buttonClass("primary", "md")}>
              Go to briefs
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {section("Awaiting approval", "Both parties must approve the current version.", awaitingApproval)}
          {section("Active", "Approved by both parties. Delivery can start.", active)}
          {section("Closed", "Completed or cancelled agreements stay readable.", closed)}
        </div>
      )}
    </div>
  );
}
