import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { listBriefs, listInvitedBriefs } from "@/lib/briefs";
import { listInvitationsForFreelancer } from "@/lib/invitations";
import { InvitationActions } from "@/components/invitation-actions";
import { buttonClass, Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Briefs" };

/**
 * Requirements 2.7 / 3.3 — the Client sees their own briefs newest-first, the
 * Freelancer sees pending invitations plus every brief they were invited to.
 */
export default async function BriefsPage() {
  const user = await requirePageSession();
  const [ownedBriefs, invitations, invitedBriefs] = await Promise.all([
    listBriefs(user.id),
    listInvitationsForFreelancer(user.id),
    listInvitedBriefs(user.id),
  ]);

  const pendingInvitations = invitations.filter((invitation) => invitation.status === "PENDING");
  const openBriefs = ownedBriefs.filter((brief) => brief.status === "OPEN");
  const drafts = ownedBriefs.filter((brief) => brief.status === "DRAFT");

  return (
    <div>
      <PageHeader
        eyebrow="Projects"
        title="Briefs"
        description="A brief is the only document a freelancer bids against. Publish it and every quotation that follows is measured against these terms."
        actions={
          <Link href="/briefs/new" className={buttonClass("primary", "md")}>
            New brief
          </Link>
        }
        meta={
          <>
            <span className="text-xs text-muted">
              Signed in as <span className="font-medium text-foreground">{user.name || user.email}</span>
            </span>
          </>
        }
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Open briefs" value={openBriefs.length} hint="Accepting quotations right now" />
        <Stat label="Drafts" value={drafts.length} hint="Not visible to freelancers yet" />
        <Stat
          label="Invitations"
          value={pendingInvitations.length}
          hint="Waiting for your decision"
          tone={pendingInvitations.length > 0 ? "danger" : "neutral"}
        />
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Invitations to you</h2>
        {pendingInvitations.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            description="When a Client invites you to bid on a brief, it appears here."
          />
        ) : (
          <div className="space-y-3">
            {pendingInvitations.map((invitation) => (
              <Card key={invitation.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{invitation.brief.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    Budget {formatMoney(Number(invitation.brief.budgetMin))} –{" "}
                    {formatMoney(Number(invitation.brief.budgetMax))} · due {formatDate(invitation.brief.targetDate)}
                  </p>
                  <p className="mt-1 max-w-2xl line-clamp-2 text-xs text-muted">{invitation.brief.description}</p>
                </div>
                <InvitationActions invitationId={invitation.id} />
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Your briefs</h2>
        {ownedBriefs.length === 0 ? (
          <EmptyState
            title="No briefs yet"
            description="Describe the work, the deliverables, the budget range and the deadline. You can edit a draft until you publish it."
            action={
              <Link href="/briefs/new" className={buttonClass("primary", "md")}>
                Create your first brief
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {ownedBriefs.map((brief) => (
              <Link key={brief.id} href={`/briefs/${brief.id}`} className="block">
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{brief.title}</p>
                      <StatusBadge status={brief.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {formatMoney(Number(brief.budgetMin))} – {formatMoney(Number(brief.budgetMax))} · target{" "}
                      {formatDate(brief.targetDate)} · created {formatDate(brief.createdAt)}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-primary">Open →</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-tight">Briefs you were invited to</h2>
        {invitedBriefs.length === 0 ? (
          <EmptyState
            title="No shared briefs"
            description="Briefs you have been invited to, accepted or not, are listed here."
          />
        ) : (
          <div className="space-y-3">
            {invitedBriefs.map((brief) => (
              <Link key={brief.id} href={`/briefs/${brief.id}`} className="block">
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-border-strong">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{brief.title}</p>
                      <StatusBadge status={brief.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted">Target {formatDate(brief.targetDate)}</p>
                  </div>
                  <span className="text-xs font-medium text-primary">Open →</span>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
