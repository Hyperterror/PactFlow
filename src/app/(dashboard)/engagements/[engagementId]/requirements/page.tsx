import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getEngagementDetail } from "@/lib/engagements";
import { allRequirementIds } from "@/lib/requirements/content";
import { Badge, buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { RequirementsView } from "@/components/requirements-view";
import { formatDateTime } from "@/lib/format";
import { RequirementsEditor } from "./requirements-editor";
import { RequirementsApproval, RequirementsComments } from "./requirements-review";

type Params = {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export const metadata: Metadata = { title: "Requirements" };

function engineLabel(engine: string): string | null {
  if (engine === "llm") return "Started from an AI draft (language model)";
  if (engine === "heuristic") return "Started from an AI draft (offline rules engine)";
  return null;
}

/**
 * Lifecycle Update PRD FR-04 / FR-05 — the requirements brief: the current
 * version with stable IDs and sources, both approvals, anchored comments, and
 * every earlier version as a read-only snapshot.
 */
export default async function RequirementsPage({ params, searchParams }: Params) {
  const user = await requirePageSession();
  const { engagementId } = await params;
  const { edit } = await searchParams;
  const detail = await getEngagementDetail(engagementId, user.id).catch(() => notFound());
  const { engagement, role, currentVersion, versions, blockers, comments } = detail;

  const editable =
    engagement.status === "DISCOVERY" ||
    engagement.status === "REQUIREMENTS" ||
    engagement.status === "REQUIREMENTS_APPROVED";
  const editing = editable && (edit === "1" || !currentVersion);
  const reviewOpen = engagement.status === "REQUIREMENTS";

  const currentComments = currentVersion
    ? comments.filter((comment) => comment.versionNumber === currentVersion.versionNumber)
    : [];
  const openByItem = new Map<string, number>();
  for (const comment of currentComments) {
    if (comment.requirementId && comment.status === "OPEN") {
      openByItem.set(comment.requirementId, (openByItem.get(comment.requirementId) ?? 0) + 1);
    }
  }
  const older = versions.filter((version) => version.versionNumber !== currentVersion?.versionNumber).reverse();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Requirements brief"
        title={detail.brief.title}
        description="What the project must achieve, agreed by both parties. Each item shows where it came from; anything unconfirmed blocks approval."
        pillar="agreement"
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={engagement.status} />
            <span>{currentVersion ? `Version ${currentVersion.versionNumber}` : "No version yet"}</span>
            <span>You are the {role === "CLIENT" ? "Client" : "Freelancer"}</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            {editable && currentVersion && !editing ? (
              <Link href={`/engagements/${engagementId}/requirements?edit=1`} className={buttonClass("secondary", "md")}>
                Propose changes
              </Link>
            ) : null}
            {engagement.status === "REQUIREMENTS_APPROVED" ? (
              <Link href={`/engagements/${engagementId}/sow`} className={buttonClass("primary", "md")}>
                Review SOW
              </Link>
            ) : null}
            <Link href={`/engagements/${engagementId}`} className={buttonClass("ghost", "md")}>
              Engagement
            </Link>
          </div>
        }
      />

      {editing ? (
        <RequirementsEditor
          engagementId={engagementId}
          baseVersion={engagement.currentRequirementsVersion}
          initial={currentVersion?.content ?? null}
        />
      ) : null}

      {!currentVersion && !editing ? (
        <EmptyState title="No requirements yet" description="This engagement closed before any requirements were saved." />
      ) : null}

      {currentVersion && !editing ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader
              title={`Version ${currentVersion.versionNumber}`}
              description={`${currentVersion.authorName} (${currentVersion.authorRole === "CLIENT" ? "Client" : "Freelancer"}) · ${formatDateTime(currentVersion.createdAt)}${currentVersion.changeSummary ? ` · ${currentVersion.changeSummary}` : ""}`}
              actions={<StatusBadge status={currentVersion.status} />}
            />
            <CardBody className="space-y-4">
              {engineLabel(currentVersion.draftEngine) ? (
                <p className="text-xs text-muted">
                  <Badge tone="info">AI draft</Badge> {engineLabel(currentVersion.draftEngine)}, reviewed and saved by{" "}
                  {currentVersion.authorName}.
                </p>
              ) : null}
              <RequirementsView
                content={currentVersion.content}
                renderExtra={(itemId) =>
                  openByItem.get(itemId) ? (
                    <p className="mt-1.5 text-xs text-warning">
                      {openByItem.get(itemId)} open comment{openByItem.get(itemId) === 1 ? "" : "s"}
                    </p>
                  ) : null
                }
              />
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Approval" description="Both parties approve the same version." />
              <CardBody>
                <RequirementsApproval
                  engagementId={engagementId}
                  versionNumber={currentVersion.versionNumber}
                  viewerRole={role}
                  clientApproved={currentVersion.clientApproved}
                  freelancerApproved={currentVersion.freelancerApproved}
                  blockers={blockers.map((blocker) => blocker.message)}
                  open={reviewOpen}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Review comments" description={`On version ${currentVersion.versionNumber}.`} />
              <CardBody>
                <RequirementsComments
                  engagementId={engagementId}
                  versionNumber={currentVersion.versionNumber}
                  itemIds={allRequirementIds(currentVersion.content)}
                  canComment={engagement.status !== "CANCELLED"}
                  comments={currentComments.map((comment) => ({
                    ...comment,
                    createdAt: comment.createdAt.toISOString(),
                  }))}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      ) : null}

      {older.length > 0 ? (
        <Card>
          <CardHeader
            title="Version history"
            description="Every saved version is immutable. Approvals belong to the version they were given on."
          />
          <CardBody>
            <ol className="space-y-2">
              {older.map((version) => (
                <li key={version.id}>
                  <details className="rounded-lg border border-border-base">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                      Version {version.versionNumber}
                      <span className="ml-2 text-xs font-normal text-muted">
                        {version.authorName} · {formatDateTime(version.createdAt)} ·{" "}
                        {version.clientApproved ? "Client approved" : "Client pending"} ·{" "}
                        {version.freelancerApproved ? "Freelancer approved" : "Freelancer pending"}
                      </span>
                    </summary>
                    <div className="border-t border-border-base px-3 py-3">
                      <RequirementsView content={version.content} />
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
