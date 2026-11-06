import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { assertBriefAccess } from "@/lib/access";
import { listOwnQuotations } from "@/lib/quotations";
import { buttonClass, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { StartDraft } from "./start-draft";

export const metadata: Metadata = { title: "New quotation" };

type Search = { searchParams: Promise<{ briefId?: string }> };

/**
 * Requirement 4.4 — a Freelancer may hold a single open draft per Brief, so an
 * existing draft is resumed rather than duplicated.
 */
export default async function NewQuotationPage({ searchParams }: Search) {
  const user = await requirePageSession();
  const { briefId } = await searchParams;
  if (!briefId) redirect("/briefs");

  const context = await assertBriefAccess(briefId, user.id).catch(() => notFound());
  // Only the Freelancer side writes quotations; the Client reviews them.
  if (context.role !== "FREELANCER") redirect(`/briefs/${briefId}`);

  const existing = await listOwnQuotations(user.id, briefId);
  const openDraft = existing.find((quotation) => quotation.status === "AI_DRAFT" || quotation.status === "DRAFT");
  if (openDraft) redirect(`/quotations/${openDraft.id}/edit`);

  const { brief } = context;

  return (
    <div>
      <PageHeader
        eyebrow="New quotation"
        title={brief.title}
        description="Both routes end in the same editor. Nothing reaches the client until you explicitly submit."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={brief.status} />
            <span>
              Budget {formatMoney(Number(brief.budgetMin))} – {formatMoney(Number(brief.budgetMax))}
            </span>
            <span>Target {formatDate(brief.targetDate)}</span>
          </div>
        }
        actions={
          <Link href={`/briefs/${briefId}`} className={buttonClass("secondary", "md")}>
            Back to brief
          </Link>
        }
      />

      <StartDraft briefId={briefId} />
    </div>
  );
}
