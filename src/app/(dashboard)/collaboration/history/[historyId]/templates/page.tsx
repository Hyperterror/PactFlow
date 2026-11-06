import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { getHistoryForParticipant, listTemplatesForClient } from "@/lib/collaboration";
import { Alert, Badge, buttonClass, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { TemplateActions, type TemplateView } from "./template-actions";

export const metadata: Metadata = { title: "Project templates" };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * Requirement 22.1 — templates are captured by the Client who owns the completed
 * project, so a Freelancer sees the context but no creation controls.
 */
function toTemplateView(template: Awaited<ReturnType<typeof listTemplatesForClient>>[number]): TemplateView {
  const data = (template.templateData && typeof template.templateData === "object"
    ? template.templateData
    : {}) as Record<string, unknown>;

  return {
    id: template.id,
    name: template.name,
    createdAt: template.createdAt.toISOString(),
    briefTitle: typeof data.briefTitle === "string" ? data.briefTitle : "Repeat project",
    description: typeof data.description === "string" ? data.description : "",
    deliverables: asStringArray(data.deliverables),
    lineItemCount: Array.isArray(data.lineItems) ? data.lineItems.length : 0,
    timelineDays: typeof data.timelineDays === "number" ? data.timelineDays : null,
    budgetMin: typeof data.budgetMin === "number" ? data.budgetMin : null,
    budgetMax: typeof data.budgetMax === "number" ? data.budgetMax : null,
    currency: typeof data.currency === "string" ? data.currency : "USD",
    milestoneCount: typeof data.milestoneCount === "number" ? data.milestoneCount : null,
  };
}

export default async function CollaborationTemplatesPage({
  params,
}: {
  params: Promise<{ historyId: string }>;
}) {
  const { historyId } = await params;
  const user = await requirePageSession();

  const history = await getHistoryForParticipant(historyId, user.id).catch(() => notFound());
  const isClient = history.viewerRole === "CLIENT";
  const templates = isClient ? await listTemplatesForClient(user.id) : [];
  const forThisProject = templates
    .filter((template) => template.historyId === historyId)
    .map(toTemplateView);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Collaboration history"
        title="Project templates"
        description={`Reusable structure captured from "${history.briefTitle}", completed ${formatDate(history.completedAt)}.`}
        meta={
          <>
            <Badge tone={isClient ? "info" : "neutral"}>
              {isClient ? "You are the Client" : "You are the Freelancer"}
            </Badge>
            <span className="text-xs text-muted">{history.counterpartName}</span>
          </>
        }
        actions={
          <Link
            href={`/collaboration/${history.clientId}/${history.freelancerId}`}
            className={buttonClass("ghost", "sm")}
          >
            Back to history
          </Link>
        }
      />

      {isClient ? (
        <TemplateActions historyId={historyId} templates={forThisProject} />
      ) : (
        <div className="space-y-4">
          <Alert tone="info" title="Templates belong to the Client">
            Project templates are captured and reused by the Client on this project. You can still review the
            collaboration summary and the confirmed working preferences.
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Link href={`/collaboration/history/${historyId}/summary`} className={buttonClass("secondary", "sm")}>
              Collaboration summary
            </Link>
            <Link
              href={`/collaboration/${history.clientId}/${history.freelancerId}`}
              className={buttonClass("ghost", "sm")}
            >
              Working preferences
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
