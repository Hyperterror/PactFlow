import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getMilestoneWithDeliverables } from "@/lib/milestones";
import { listRevisionRequests } from "@/lib/deliverables/review";
import { Alert, Badge, buttonClass, Card, CardBody, CardHeader, KeyValue, PageHeader, StatusBadge } from "@/components/ui";
import { formatBytes, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { DeliveryActions } from "./delivery-actions";

type Params = { params: Promise<{ milestoneId: string }> };

export const metadata: Metadata = { title: "Delivery room" };

/**
 * Requirements 14.1 / 15.1 / 15.5 — the room shows the watermarked preview, the
 * version history, the revision budget and the payment gate in one place.
 */
export default async function DeliveryRoomPage({ params }: Params) {
  const user = await requirePageSession();
  const { milestoneId } = await params;

  const context = await getMilestoneWithDeliverables(milestoneId, user.id).catch(() => notFound());
  const { milestone, deliverables, payment, agreement, role } = context;

  const latest = deliverables[0] ?? null;
  const revisions = latest ? await listRevisionRequests(latest.id) : [];
  const paymentCaptured = payment?.status === "CAPTURED";
  const originalUnlocked = role === "FREELANCER" || paymentCaptured;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delivery room"
        title={milestone.name}
        description={milestone.description}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={milestone.status} />
            {payment ? <StatusBadge status={payment.status} /> : null}
            <span>{formatMoney(Number(milestone.paymentAmount), agreement.currency)}</span>
            <span>Due {formatDate(milestone.dueDate)}</span>
            <span>You are the {role === "CLIENT" ? "Client" : "Freelancer"}</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/agreements/${milestone.agreementId}`} className={buttonClass("secondary", "md")}>
              Agreement
            </Link>
            <Link href={`/delivery/${milestoneId}/checkout`} className={buttonClass("ghost", "md")}>
              Checkout
            </Link>
          </div>
        }
      />

      {!originalUnlocked ? (
        <Alert tone="warning" title="Original file locked">
          You can review the watermarked preview now. The original file and its signed download link are released only
          after the payment is captured.
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <DeliveryActions
            milestoneId={milestoneId}
            milestoneStatus={milestone.status}
            role={role}
            revisionLimit={agreement.revisionLimit}
            latestDeliverable={
              latest
                ? {
                    id: latest.id,
                    status: latest.status,
                    versionNumber: latest.versionNumber,
                    revisionCount: latest.revisionCount,
                  }
                : null
            }
            payment={payment ? { id: payment.id, status: payment.status, approveUrl: payment.approveUrl } : null}
          />

          <Card>
            <CardHeader
              title="Preview"
              description="A watermarked copy. Downloads of the original are gated on payment."
              actions={<Badge tone={paymentCaptured ? "success" : "warning"}>{paymentCaptured ? "Original released" : "PREVIEW only"}</Badge>}
            />
            <CardBody>
              {latest ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{latest.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Version {latest.versionNumber} · {formatBytes(latest.fileSizeBytes)} · SHA-256{" "}
                      <span className="font-mono">{latest.originalHash.slice(0, 12)}…</span> · uploaded{" "}
                      {formatDateTime(latest.uploadedAt)}
                    </p>
                  </div>
                  <a
                    href={`/api/deliverables/${latest.id}/preview`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonClass("secondary", "sm")}
                  >
                    Open watermarked preview
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted">Nothing uploaded yet.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Version history"
              description="Every upload is kept. Earlier versions stay reviewable and hash-verified."
            />
            <CardBody>
              {deliverables.length === 0 ? (
                <p className="text-sm text-muted">No versions yet.</p>
              ) : (
                <ul className="divide-y divide-border-base">
                  {deliverables.map((deliverable) => (
                    <li
                      key={deliverable.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          v{deliverable.versionNumber}
                          <StatusBadge status={deliverable.status} />
                          <span className="truncate text-muted">{deliverable.fileName}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatBytes(deliverable.fileSizeBytes)} · {formatDateTime(deliverable.uploadedAt)} ·{" "}
                          {deliverable.revisionCount} revision
                          {deliverable.revisionCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <a
                        href={`/api/deliverables/${deliverable.id}/preview`}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClass("ghost", "sm")}
                      >
                        Preview
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {revisions.length > 0 ? (
            <Card>
              <CardHeader title="Revision requests" description="Feedback the Client left on this deliverable." />
              <CardBody>
                <ul className="space-y-3">
                  {revisions.map((revision) => (
                    <li key={revision.id} className="rounded-lg border border-border-base p-3">
                      <p className="text-xs text-muted">{formatDateTime(revision.createdAt)}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{revision.feedbackText}</p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Milestone" />
            <CardBody className="space-y-3">
              <KeyValue label="Status">
                <StatusBadge status={milestone.status} />
              </KeyValue>
              <KeyValue label="Amount">{formatMoney(Number(milestone.paymentAmount), agreement.currency)}</KeyValue>
              <KeyValue label="Due">{formatDate(milestone.dueDate)}</KeyValue>
              <KeyValue label="Delivered">{milestone.deliveredAt ? formatDateTime(milestone.deliveredAt) : "—"}</KeyValue>
              <KeyValue label="Approved">{milestone.approvedAt ? formatDateTime(milestone.approvedAt) : "—"}</KeyValue>
              <KeyValue label="Revision limit">{agreement.revisionLimit} rounds</KeyValue>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment" />
            <CardBody className="space-y-3">
              {payment ? (
                <>
                  <KeyValue label="Status">
                    <StatusBadge status={payment.status} />
                  </KeyValue>
                  <KeyValue label="Expected">{formatMoney(Number(payment.amountExpected), payment.currency)}</KeyValue>
                  <KeyValue label="Captured">
                    {payment.amountCaptured === null ? "—" : formatMoney(Number(payment.amountCaptured), payment.currency)}
                  </KeyValue>
                  <KeyValue label="Order">
                    <span className="font-mono text-xs">{payment.paypalOrderId ?? "—"}</span>
                  </KeyValue>
                  <KeyValue label="Captured at">
                    {payment.capturedAt ? formatDateTime(payment.capturedAt) : "—"}
                  </KeyValue>
                  {payment.reviewFlag ? (
                    <Alert tone="warning">This capture needs a manual review before the file is released.</Alert>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">No payment started for this milestone.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Discussion" description="Scope questions belong in the project discussion." />
            <CardBody>
              <Link
                href={`/agreements/${milestone.agreementId}/discussion`}
                className={buttonClass("secondary", "sm")}
              >
                Open discussion
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
