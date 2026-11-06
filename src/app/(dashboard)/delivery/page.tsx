import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { listMilestonesForUser } from "@/lib/milestones";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Delivery" };

/**
 * Requirement 13.x — the Delivery Room index. Milestones are listed in due-date
 * order inside each agreement, because that is the order they are worked.
 */
export default async function DeliveryPage() {
  const user = await requirePageSession();
  const projects = await listMilestonesForUser(user.id);
  const withMilestones = projects.filter((project) => project.milestones.length > 0);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delivery"
        title="Delivery rooms"
        description="Each milestone has its own room: upload, preview, review, then payment. The original file stays locked until the payment is captured."
      />

      {withMilestones.length === 0 ? (
        <EmptyState
          title="No milestones yet"
          description="Milestones are created on an active agreement. Approve an agreement first, then define the milestones."
          action={
            <Link href="/agreements" className={buttonClass("primary", "md")}>
              Go to agreements
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {withMilestones.map((project) => (
            <Card key={project.agreementId}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {project.title}
                    <StatusBadge status={project.status} />
                    <Badge tone={project.role === "CLIENT" ? "info" : "neutral"}>
                      {project.role === "CLIENT" ? "You are the Client" : "You are the Freelancer"}
                    </Badge>
                  </span>
                }
                description={`${project.milestones.length} milestone${project.milestones.length === 1 ? "" : "s"} · ${project.revisionLimit} revision rounds per deliverable`}
                actions={
                  <Link href={`/agreements/${project.agreementId}`} className={buttonClass("ghost", "sm")}>
                    Agreement
                  </Link>
                }
              />
              <CardBody>
                <ul className="divide-y divide-border-base">
                  {project.milestones.map((milestone) => (
                    <li
                      key={milestone.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {milestone.name}
                          <StatusBadge status={milestone.status} />
                          {milestone.paymentStatus ? <StatusBadge status={milestone.paymentStatus} /> : null}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatMoney(milestone.paymentAmount, project.currency)} · due{" "}
                          {formatDate(milestone.dueDate)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Link href={`/delivery/${milestone.id}`} className={buttonClass("secondary", "sm")}>
                          Open room
                        </Link>
                        <Link href={`/delivery/${milestone.id}/checkout`} className={buttonClass("ghost", "sm")}>
                          Checkout
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
