import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { listMilestonesForUser } from "@/lib/milestones";
import { buildSchedule, type ScheduleMilestone } from "@/lib/milestones/schedule";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { MilestoneGantt } from "@/components/milestone-gantt";
import { DeliveryViewTabs, type DeliveryView } from "./delivery-view-tabs";
import { prisma } from "@/lib/prisma";
import { PayoutAccountForm } from "@/components/payout-panel";

export const metadata: Metadata = { title: "Delivery" };

type SearchParams = { searchParams: Promise<{ view?: string }> };

/** A milestone is late when its deadline passed and it is not yet approved. */
function isOverdue(dueDate: Date, status: string, now: Date): boolean {
  return dueDate.getTime() < now.getTime() && status !== "APPROVED" && status !== "OVERDUE";
}

/**
 * Requirements 13.6 / 13.7 — the Delivery Room index.
 *
 * The timeline is the default reading: milestones are laid out along their due
 * dates so the shape of the engagement is visible at a glance. The row view
 * stays one click away because it is what you use to actually open a room.
 */
export default async function DeliveryPage({ searchParams }: SearchParams) {
  const user = await requirePageSession();
  const { view } = await searchParams;
  const activeView: DeliveryView = view === "rows" ? "rows" : "timeline";

  const projects = await listMilestonesForUser(user.id);
  const withMilestones = projects.filter((project) => project.milestones.length > 0);
  const now = new Date();
  const isFreelancerSomewhere = projects.some((project) => project.role === "FREELANCER");
  const payoutAccount = isFreelancerSomewhere
    ? await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { paypalPayoutEmail: true } })
    : null;

  const timelines = withMilestones.map((project) => ({
    project,
    tasks: buildSchedule(
      project.milestones.map<ScheduleMilestone>((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        description: milestone.description,
        dueDate: milestone.dueDate,
        paymentAmount: milestone.paymentAmount,
        status: milestone.status,
        paymentStatus: milestone.paymentStatus,
        overdue: isOverdue(milestone.dueDate, milestone.status, now),
      })),
      (amount) => formatMoney(amount, project.currency),
    ),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delivery"
        title="Delivery rooms"
        description="Every milestone is a payment gate: upload, preview, review, then payment. The original file stays locked until the payment is captured."
        pillar="delivery"
        meta={
          withMilestones.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <DeliveryViewTabs active={activeView} />
              <span className="text-xs text-muted">
                {withMilestones.reduce((total, project) => total + project.milestones.length, 0)} milestones
                across {withMilestones.length} agreement{withMilestones.length === 1 ? "" : "s"}
              </span>
            </div>
          ) : null
        }
      />

      {payoutAccount ? (
        <Card>
          <CardHeader
            title="Getting paid"
            description="Each milestone the Client pays is captured to the platform, verified, then sent to you with PayPal Payouts."
            actions={
              <Badge tone={payoutAccount.paypalPayoutEmail ? "success" : "warning"}>
                {payoutAccount.paypalPayoutEmail ? "Payout email set" : "Payout email missing"}
              </Badge>
            }
          />
          <CardBody>
            <PayoutAccountForm initialEmail={payoutAccount.paypalPayoutEmail} />
          </CardBody>
        </Card>
      ) : null}

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
      ) : activeView === "timeline" ? (
        <div className="space-y-4">
          {timelines.map(({ project, tasks }) => (
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
                description="Scroll sideways over the bars, use the wheel to zoom, then open a room from the row below."
                actions={
                  <Link href={`/agreements/${project.agreementId}`} className={buttonClass("ghost", "sm")}>
                    Agreement
                  </Link>
                }
              />
              <CardBody className="space-y-4">
                <MilestoneGantt
                  tasks={tasks}
                  agreementTitle={project.title}
                  currency={project.currency}
                />
                <ul className="flex flex-wrap gap-2 border-t border-border-base pt-3 text-xs">
                  {project.milestones.map((milestone) => (
                    <li key={milestone.id}>
                      <Link
                        href={`/delivery/${milestone.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-base px-2.5 py-1 text-muted transition-colors hover:border-border-strong hover:text-foreground"
                      >
                        {milestone.name}
                        <span className="tabular text-muted-soft">{formatDate(milestone.dueDate)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
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