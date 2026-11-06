import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { listCollaborationPairs } from "@/lib/collaboration";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Collaboration" };

/**
 * Requirement 20.1/20.3 — one row per Client-Freelancer pair. A pair only exists
 * once a project has completed, so the empty state here means nothing has closed
 * yet rather than a permissions problem.
 */
export default async function CollaborationPage() {
  const user = await requirePageSession();
  const pairs = await listCollaborationPairs(user.id);

  const totalProjects = pairs.reduce((sum, pair) => sum + pair.projectCount, 0);
  const totalConfirmed = pairs.reduce((sum, pair) => sum + pair.confirmedPreferenceCount, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Relationship intelligence"
        title="Collaboration"
        description="Every counterpart you have finished a project with, the preferences you both confirmed, and the grounded summary you can carry into a repeat engagement."
      />

      {pairs.length === 0 ? (
        <EmptyState
          title="No completed projects yet"
          description="A collaboration history appears here once an agreement's milestones are all approved and every payment is captured."
          action={
            <Link href="/agreements" className={buttonClass("primary", "md")}>
              Go to agreements
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Counterparts" value={pairs.length} />
            <Stat label="Completed projects" value={totalProjects} />
            <Stat label="Confirmed preferences" value={totalConfirmed} />
          </div>

          <div className="space-y-4">
            {pairs.map((pair) => (
              <Card key={`${pair.clientId}:${pair.freelancerId}`}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {pair.counterpartName}
                      <Badge tone={pair.viewerRole === "CLIENT" ? "info" : "neutral"}>
                        {pair.viewerRole === "CLIENT" ? "You are the Client" : "You are the Freelancer"}
                      </Badge>
                    </span>
                  }
                  description={`${pair.projectCount} completed project${
                    pair.projectCount === 1 ? "" : "s"
                  } · last completed ${formatDate(pair.lastCompletedAt)}`}
                  actions={
                    <Link
                      href={`/collaboration/${pair.clientId}/${pair.freelancerId}`}
                      className={buttonClass("secondary", "sm")}
                    >
                      Open history
                    </Link>
                  }
                />
                <CardBody>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Stat label="Total paid across projects" value={formatMoney(pair.totalPaymentAmount)} />
                    <Stat
                      label="Confirmed preferences"
                      value={pair.confirmedPreferenceCount}
                      hint={
                        pair.confirmedPreferenceCount === 0
                          ? "None acknowledged yet"
                          : "Both parties acknowledged"
                      }
                    />
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
