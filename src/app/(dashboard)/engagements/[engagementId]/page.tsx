import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getEngagementDetail } from "@/lib/engagements";
import {
  Alert,
  Badge,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  KeyValue,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CancelEngagement, DiscoveryTermsForm, DiscoveryThread } from "./engagement-client";

type Params = { params: Promise<{ engagementId: string }> };

export const metadata: Metadata = { title: "Engagement" };

const STEPS = [
  { key: "DISCOVERY", label: "Discovery" },
  { key: "REQUIREMENTS", label: "Requirements review" },
  { key: "REQUIREMENTS_APPROVED", label: "Requirements approved" },
  { key: "AGREEMENT", label: "SOW → agreement" },
] as const;

function Steps({ status }: { status: string }) {
  const index = STEPS.findIndex((step) => step.key === status);
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Engagement progress">
      {STEPS.map((step, position) => {
        const state = status === "CANCELLED" ? "idle" : position < index ? "done" : position === index ? "current" : "idle";
        return (
          <li
            key={step.key}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
              state === "done" && "bg-success-soft text-success ring-success/20",
              state === "current" && "bg-primary-soft text-primary ring-primary/30",
              state === "idle" && "bg-surface-muted text-muted ring-border-base",
            )}
          >
            {position + 1}. {step.label}
            {state === "done" ? " ✓" : ""}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Lifecycle Update PRD FR-03 — the Engagement workspace: who was selected and on
 * what proposal, the discovery terms and thread, and where the requirements and
 * SOW stand. No contract exists yet on this page.
 */
export default async function EngagementPage({ params }: Params) {
  const user = await requirePageSession();
  const { engagementId } = await params;
  const detail = await getEngagementDetail(engagementId, user.id).catch(() => notFound());
  const { engagement, role, brief, proposal, currentVersion, blockers } = detail;

  const open = engagement.status !== "AGREEMENT" && engagement.status !== "CANCELLED";
  const termsEditable = engagement.status === "DISCOVERY" || engagement.status === "REQUIREMENTS";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Engagement"
        title={brief.title}
        description="Selecting a proposal is not a contract. Agree what is being built here first; the SOW and agreement come after."
        pillar="agreement"
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={engagement.status} />
            <span>You are the {role === "CLIENT" ? "Client" : "Freelancer"}</span>
            <span>Selected {formatDate(engagement.selectedAt)}</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/engagements/${engagementId}/requirements`} className={buttonClass("primary", "md")}>
              Requirements
            </Link>
            <Link href={`/briefs/${brief.id}`} className={buttonClass("ghost", "md")}>
              Brief
            </Link>
          </div>
        }
      />

      <Steps status={engagement.status} />

      {engagement.status === "CANCELLED" ? (
        <Alert tone="warning">
          Cancelled {formatDate(engagement.cancelledAt)}: {engagement.cancelReason}. The record stays readable.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Where things stand"
              description="Requirements first, then the SOW, then the agreement — each approved by both of you."
            />
            <CardBody className="space-y-3">
              {engagement.status === "DISCOVERY" ? (
                <p className="text-sm">
                  No requirements yet. Discuss below, then draft the requirements brief — with AI or by hand.
                </p>
              ) : null}
              {currentVersion ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-semibold">
                      Requirements version {currentVersion.versionNumber}{" "}
                      <StatusBadge status={currentVersion.status} />
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Client {currentVersion.clientApproved ? "approved" : "pending"} · Freelancer{" "}
                      {currentVersion.freelancerApproved ? "approved" : "pending"}
                      {blockers.length > 0 ? ` · ${blockers.length} item${blockers.length === 1 ? "" : "s"} block approval` : ""}
                    </p>
                  </div>
                  <Link href={`/engagements/${engagementId}/requirements`} className={buttonClass("secondary", "sm")}>
                    Review requirements
                  </Link>
                </div>
              ) : null}
              {engagement.status === "REQUIREMENTS_APPROVED" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5">
                  <p className="text-sm">Both of you approved the same version. The SOW can now be generated.</p>
                  <Link href={`/engagements/${engagementId}/sow`} className={buttonClass("primary", "sm")}>
                    Review SOW
                  </Link>
                </div>
              ) : null}
              {detail.agreement ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm">
                    Agreement created from the SOW · <StatusBadge status={detail.agreement.status} />
                  </p>
                  <Link href={`/agreements/${detail.agreement.id}`} className={buttonClass("primary", "sm")}>
                    Open agreement
                  </Link>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Discovery discussion"
              description="Clarify the work before committing to it. Messages are timestamped and attributed."
            />
            <CardBody>
              <DiscoveryThread
                engagementId={engagementId}
                viewerRole={role}
                canPost={engagement.status !== "CANCELLED"}
                messages={detail.messages.map((message) => ({
                  ...message,
                  createdAt: message.createdAt.toISOString(),
                }))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Selected proposal"
              description={`From ${detail.freelancerName}. It is the commercial starting point for the SOW, not the contract.`}
            />
            <CardBody className="space-y-3">
              <ul className="divide-y divide-border-base">
                {proposal.lineItems.map((item, index) => (
                  <li key={index} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                    <span className="min-w-0">{item.description}</span>
                    <span className="shrink-0 font-medium">{formatMoney(item.price)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-4 pt-2 text-sm font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(proposal.total)}</span>
                </li>
              </ul>
              <p className="text-xs text-muted">Timeline {proposal.timelineDays} days</p>
              {proposal.notes ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{proposal.notes}</p> : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Parties" />
            <CardBody className="space-y-3">
              <KeyValue label="Client">{detail.clientName}</KeyValue>
              <KeyValue label="Freelancer">{detail.freelancerName}</KeyValue>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Brief" />
            <CardBody className="space-y-3">
              <KeyValue label="Budget">
                {formatMoney(brief.budgetMin)} – {formatMoney(brief.budgetMax)}
              </KeyValue>
              <KeyValue label="Target date">{formatDate(brief.targetDate)}</KeyValue>
              <KeyValue label="Deliverables">
                <ul className="list-disc pl-4">
                  {brief.deliverables.map((deliverable, index) => (
                    <li key={index}>{deliverable}</li>
                  ))}
                </ul>
              </KeyValue>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Discovery terms"
              description="Whether this clarification work is paid, and for how long."
              actions={<Badge tone="neutral">{humanize(engagement.discoveryType)}</Badge>}
            />
            <CardBody>
              <DiscoveryTermsForm
                engagementId={engagementId}
                editable={termsEditable}
                initial={{
                  discoveryType: engagement.discoveryType,
                  discoveryDays: engagement.discoveryDays,
                  discoveryFee: engagement.discoveryFee === null ? null : Number(engagement.discoveryFee),
                  discoveryNotes: engagement.discoveryNotes,
                }}
              />
            </CardBody>
          </Card>

          {open ? (
            <Card>
              <CardBody>
                <CancelEngagement engagementId={engagementId} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
