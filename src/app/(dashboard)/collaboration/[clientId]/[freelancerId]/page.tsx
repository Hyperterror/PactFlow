import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { getCollaborationProfile, listTemplatesForClient } from "@/lib/collaboration";
import { listBriefs } from "@/lib/briefs";
import { Badge, buttonClass, Card, CardBody, CardHeader, KeyValue, PageHeader, Stat } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { PreferenceBoard } from "./preference-board";
import { RepeatInvite } from "./repeat-invite";

export const metadata: Metadata = { title: "Collaboration history" };

const INVITABLE_BRIEF_STATUSES = ["DRAFT", "OPEN"];

/**
 * Requirement 20.3/20.6 — this page exists only for the two people in the pair.
 * Anybody else is rejected inside the library, which also records the attempt, so
 * the page answers with a 404 rather than confirming the pair exists.
 */
export default async function CollaborationProfilePage({
  params,
}: {
  params: Promise<{ clientId: string; freelancerId: string }>;
}) {
  const { clientId, freelancerId } = await params;
  const user = await requirePageSession();

  const profile = await getCollaborationProfile(clientId, freelancerId, user.id).catch(() => notFound());
  const counterpartName = profile.viewerRole === "CLIENT" ? profile.freelancerName : profile.clientName;
  const isClient = profile.viewerRole === "CLIENT";

  const [briefs, templates]: [
    Awaited<ReturnType<typeof listBriefs>>,
    Awaited<ReturnType<typeof listTemplatesForClient>>,
  ] = isClient ? await Promise.all([listBriefs(user.id), listTemplatesForClient(user.id)]) : [[], []];

  const invitableBriefs = briefs
    .filter((brief) => INVITABLE_BRIEF_STATUSES.includes(brief.status))
    .map((brief) => ({ id: brief.id, title: brief.title, status: brief.status }));

  const totalPaid = profile.histories.reduce((sum, history) => sum + history.totalPaymentAmount, 0);
  const historyOptions = profile.histories.map((history) => ({
    id: history.id,
    label: `${history.briefTitle} · ${formatDate(history.completedAt)}`,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Collaboration history"
        title={counterpartName}
        description={`Everything you and ${counterpartName} have finished together, plus the working preferences you both confirmed. Only the two of you can see this page.`}
        meta={
          <>
            <Badge tone={isClient ? "info" : "neutral"}>
              {isClient ? "You are the Client" : "You are the Freelancer"}
            </Badge>
            <span className="text-xs text-muted">
              {profile.histories.length} completed project{profile.histories.length === 1 ? "" : "s"}
            </span>
          </>
        }
        actions={
          <Link href="/collaboration" className={buttonClass("ghost", "sm")}>
            All collaborations
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Completed projects" value={profile.histories.length} />
        <Stat label="Total paid" value={formatMoney(totalPaid)} />
        <Stat label="Confirmed preferences" value={profile.confirmedPreferences.length} />
        <Stat
          label="Awaiting acknowledgement"
          value={profile.pendingPreferences.length}
          tone={profile.pendingPreferences.length > 0 ? "danger" : "neutral"}
        />
      </div>

      <Card>
        <CardHeader
          title="Completed projects"
          description="Each entry is append-only: the history records what was agreed and paid, and nothing here can rewrite it."
          actions={
            isClient && profile.histories.length > 0 ? (
              <Link
                href={`/collaboration/history/${profile.histories[0].id}/templates`}
                className={buttonClass("secondary", "sm")}
              >
                Start new project from template
              </Link>
            ) : null
          }
        />
        <CardBody>
          {profile.histories.length === 0 ? (
            <p className="text-sm text-muted">
              No completed project yet. A history entry is created once every milestone is approved and paid.
            </p>
          ) : (
            <ul className="divide-y divide-border-base">
              {profile.histories.map((history) => (
                <li key={history.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{history.briefTitle}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        Completed {formatDate(history.completedAt)} · {formatMoney(history.totalPaymentAmount)} ·{" "}
                        {history.deliverableCount} deliverable{history.deliverableCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/collaboration/history/${history.id}/summary`}
                        className={buttonClass("secondary", "sm")}
                      >
                        AI summary
                      </Link>
                      {isClient ? (
                        <Link
                          href={`/collaboration/history/${history.id}/templates`}
                          className={buttonClass("ghost", "sm")}
                        >
                          Templates
                        </Link>
                      ) : null}
                      <Link
                        href={`/agreements/${history.agreementId}`}
                        className={buttonClass("ghost", "sm")}
                      >
                        Agreement
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Working preferences"
          description="A preference counts only when both parties have acknowledged it. Confirmed wording can never be edited in place."
        />
        <CardBody>
          <PreferenceBoard
            viewerId={user.id}
            counterpartName={counterpartName}
            historyOptions={historyOptions}
            confirmed={profile.confirmedPreferences.map((preference) => ({
              id: preference.id,
              historyId: preference.historyId,
              statement: preference.statement,
              authorRole: preference.authorRole,
              authorId: preference.authorRole === "CLIENT" ? profile.clientId : profile.freelancerId,
              acknowledgedAt: preference.acknowledgedAt ? preference.acknowledgedAt.toISOString() : null,
            }))}
            pending={profile.pendingPreferences.map((preference) => ({
              id: preference.id,
              historyId: preference.historyId,
              statement: preference.statement,
              authorRole: preference.authorRole,
              authorId: preference.authorId,
              acknowledgedAt: null,
              createdAt: preference.createdAt.toISOString(),
            }))}
          />
        </CardBody>
      </Card>

      {isClient ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Repeat engagement"
              description="Invite this Freelancer again. The most recent summary travels with the invitation."
            />
            <CardBody>
              <RepeatInvite
                freelancerId={profile.freelancerId}
                counterpartName={counterpartName}
                briefs={invitableBriefs}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Your project templates"
              description="Reusable structure captured from completed projects."
              actions={
                profile.histories.length > 0 ? (
                  <Link
                    href={`/collaboration/history/${profile.histories[0].id}/templates`}
                    className={buttonClass("ghost", "sm")}
                  >
                    Manage
                  </Link>
                ) : null
              }
            />
            <CardBody>
              {templates.length === 0 ? (
                <p className="text-sm leading-relaxed text-muted">
                  No templates yet. Open a completed project and capture one so the next brief starts
                  pre-filled instead of blank.
                </p>
              ) : (
                <dl className="divide-y divide-border-base">
                  {templates.slice(0, 5).map((template) => (
                    <KeyValue key={template.id} label={template.name}>
                      {formatDate(template.createdAt)}
                    </KeyValue>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
