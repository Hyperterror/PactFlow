import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { listEngagementSummaries } from "@/lib/engagements";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Engagements" };

/**
 * Selecting a proposal opens an Engagement: the space where the two parties
 * agree what is being built before anything is signed.
 */
export default async function EngagementsPage() {
  const user = await requirePageSession();
  const engagements = await listEngagementSummaries(user.id);

  const open = engagements.filter((row) => row.status !== "AGREEMENT" && row.status !== "CANCELLED");
  const signed = engagements.filter((row) => row.status === "AGREEMENT");
  const cancelled = engagements.filter((row) => row.status === "CANCELLED");

  function section(title: string, description: string, rows: typeof engagements) {
    if (rows.length === 0) return null;
    return (
      <Card>
        <CardHeader title={title} description={description} />
        <CardBody>
          <ul className="divide-y divide-border-base">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {row.title}
                    <StatusBadge status={row.status} />
                    <Badge tone={row.role === "CLIENT" ? "info" : "neutral"}>
                      {row.role === "CLIENT" ? "You selected" : "You were selected"}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.counterpartName} ·{" "}
                    {row.currentRequirementsVersion === 0
                      ? "no requirements yet"
                      : `requirements v${row.currentRequirementsVersion}`}{" "}
                    · selected {formatDate(row.selectedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/engagements/${row.id}`} className={buttonClass("secondary", "sm")}>
                    Open
                  </Link>
                  {row.agreementId ? (
                    <Link href={`/agreements/${row.agreementId}`} className={buttonClass("ghost", "sm")}>
                      Agreement
                    </Link>
                  ) : null}
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
        eyebrow="Engagements"
        title="Engagements"
        description="Choosing a freelancer is not a contract. Here both sides agree the requirements, then the SOW, before anything is signed."
        pillar="agreement"
      />
      {engagements.length === 0 ? (
        <EmptyState
          title="No engagements yet"
          description="Selecting a submitted proposal opens an engagement for discovery and requirements."
          action={
            <Link href="/briefs" className={buttonClass("primary", "md")}>
              Go to briefs
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {section("In progress", "Discovery and requirements, before the SOW.", open)}
          {section("Agreement created", "The SOW was submitted; approval continues on the agreement.", signed)}
          {section("Cancelled", "Kept for the record. The brief can select another proposal.", cancelled)}
        </div>
      )}
    </div>
  );
}
