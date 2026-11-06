import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getAgreementDetail } from "@/lib/agreements";
import {
  Badge,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  KeyValue,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/format";
import { AgreementApprove } from "./agreement-approve";

type Params = { params: Promise<{ agreementId: string }> };

export const metadata: Metadata = { title: "Agreement" };

interface Snapshot {
  title?: string;
  description?: string;
  deliverables?: string[];
  budgetMin?: number;
  budgetMax?: number;
  lineItems?: Array<{ description?: string; price?: number }>;
  total?: number;
  timelineDays?: number;
  notes?: string;
  currency?: string;
  capturedAt?: string;
  amendedBy?: string;
}

function SnapshotBody({ snapshot }: { snapshot: Snapshot }) {
  const currency = snapshot.currency ?? "USD";
  const lineItems = Array.isArray(snapshot.lineItems) ? snapshot.lineItems : [];
  const deliverables = Array.isArray(snapshot.deliverables) ? snapshot.deliverables : [];

  return (
    <div className="space-y-4">
      {snapshot.description ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Scope</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{snapshot.description}</p>
        </div>
      ) : null}

      {deliverables.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Deliverables</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {deliverables.map((deliverable, index) => (
              <li key={index}>{deliverable}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Line items</p>
        {lineItems.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No line items recorded.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border-base">
            {lineItems.map((item, index) => (
              <li key={index} className="flex items-center justify-between gap-4 py-1.5 text-sm">
                <span className="min-w-0 truncate">{item.description || "Untitled"}</span>
                <span className="shrink-0 font-medium">{formatMoney(item.price ?? 0, currency)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>{formatMoney(snapshot.total ?? 0, currency)}</span>
            </li>
          </ul>
        )}
      </div>

      {snapshot.notes ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{snapshot.notes}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border-base pt-3 text-xs text-muted">
        <span>Timeline {snapshot.timelineDays ?? "—"} days</span>
        {snapshot.budgetMin !== undefined && snapshot.budgetMax !== undefined ? (
          <span>
            Brief budget {formatMoney(snapshot.budgetMin, currency)} – {formatMoney(snapshot.budgetMax, currency)}
          </span>
        ) : null}
        {snapshot.amendedBy ? <span>Amended by {humanize(String(snapshot.amendedBy))}</span> : null}
        <span>Captured {formatDateTime(snapshot.capturedAt)}</span>
      </div>
    </div>
  );
}

/**
 * Requirements 9.1–9.7 — the current version is shown in full, both approval
 * states are visible, and every earlier version stays readable as an immutable
 * snapshot.
 */
export default async function AgreementPage({ params }: Params) {
  const user = await requirePageSession();
  const { agreementId } = await params;

  const detail = await getAgreementDetail(agreementId, user.id).catch(() => notFound());
  const { agreement, role, versions, currentVersion, approvalState, milestones } = detail;

  const current = (currentVersion?.content ?? {}) as unknown as Snapshot;
  const older = versions.filter((version) => version.versionNumber !== agreement.currentVersion).reverse();
  const canApprove = agreement.status === "PENDING_APPROVAL";

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Agreement"
        title={current.title ?? "Agreement"}
        description="Both parties approved this text. Delivery, revisions and payment all hang off this version."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={agreement.status} />
            <span>Version {agreement.currentVersion}</span>
            <span>You are the {role === "CLIENT" ? "Client" : "Freelancer"}</span>
            <span>Created {formatDate(agreement.createdAt)}</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/agreements/${agreementId}/discussion`} className={buttonClass("secondary", "md")}>
              Discussion
            </Link>
            <Link href={`/briefs/${agreement.briefId}`} className={buttonClass("ghost", "md")}>
              Brief
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Version ${agreement.currentVersion}`}
              description={
                agreement.status === "ACTIVE"
                  ? "Active — this is the version the project runs on."
                  : "Pending approval — no delivery or payment can start until both parties approve."
              }
              actions={<Badge tone={agreement.status === "ACTIVE" ? "success" : "warning"}>{humanize(agreement.status)}</Badge>}
            />
            <CardBody>
              <SnapshotBody snapshot={current} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Milestones"
              description="Delivery and payment are tracked per milestone. The Client releases funds only after approving work."
            />
            <CardBody>
              {milestones.length === 0 ? (
                <EmptyState
                  title="No milestones defined"
                  description="Milestones are created when the agreement becomes active."
                />
              ) : (
                <ul className="divide-y divide-border-base">
                  {milestones.map((milestone) => (
                    <li
                      key={milestone.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                          {milestone.name}
                          <StatusBadge status={milestone.status} />
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatMoney(Number(milestone.paymentAmount), agreement.currency)} · due{" "}
                          {formatDate(milestone.dueDate)}
                        </p>
                      </div>
                      <Link href={`/delivery/${milestone.id}`} className={buttonClass("secondary", "sm")}>
                        Delivery room
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Version history"
              description="Every version is an immutable snapshot. Later versions never rewrite earlier ones."
            />
            <CardBody>
              <ol className="space-y-2">
                {older.length === 0 ? (
                  <p className="text-sm text-muted">This is the first version.</p>
                ) : (
                  older.map((version) => (
                    <li key={version.id}>
                      <details className="rounded-lg border border-border-base">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                          Version {version.versionNumber}
                          <span className="ml-2 text-xs font-normal text-muted">
                            {humanize(version.authorRole)} · {formatDateTime(version.createdAt)}
                          </span>
                        </summary>
                        <div className="border-t border-border-base px-3 py-3">
                          <SnapshotBody snapshot={version.content as unknown as Snapshot} />
                        </div>
                      </details>
                    </li>
                  ))
                )}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Approval" description="One approval per party, per version." />
            <CardBody>
              <AgreementApprove
                agreementId={agreementId}
                versionNumber={agreement.currentVersion}
                viewerRole={role}
                clientApproved={approvalState.clientApproved}
                freelancerApproved={approvalState.freelancerApproved}
                canApprove={canApprove}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Terms at a glance" />
            <CardBody className="space-y-3">
              <KeyValue label="Revision limit">{agreement.revisionLimit} rounds per deliverable</KeyValue>
              <KeyValue label="Currency">{agreement.currency}</KeyValue>
              <KeyValue label="Start date">{agreement.startDate ? formatDate(agreement.startDate) : "Not started"}</KeyValue>
              <KeyValue label="Completed">{agreement.completedAt ? formatDate(agreement.completedAt) : "—"}</KeyValue>
              <KeyValue label="Versions">{versions.length}</KeyValue>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
