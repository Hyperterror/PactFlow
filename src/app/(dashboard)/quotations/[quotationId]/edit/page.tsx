import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getQuotationForViewer } from "@/lib/quotations";
import { pricingEditorView } from "@/lib/ai/pricing";
import { AI_MAX_REGENERATIONS } from "@/lib/ai/quotation";
import { buttonClass, PageHeader, StatusBadge } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { QuotationEditor, type EditorLineItem } from "@/components/quotation-editor";

export const metadata: Metadata = { title: "Edit quotation" };

type Params = { params: Promise<{ quotationId: string }> };

/**
 * Requirements 4.5 / 5.3 — the editor shows the AI draft beside editable fields,
 * a per-line-item pricing recommendation, and the remaining regeneration budget.
 */
export default async function EditQuotationPage({ params }: Params) {
  const user = await requirePageSession();
  const { quotationId } = await params;

  const { quotation, viewerRole } = await getQuotationForViewer(quotationId, user.id).catch(() => notFound());
  // The Client never edits a quotation; send them to the read-only view.
  if (viewerRole !== "FREELANCER") redirect(`/quotations/${quotationId}`);

  const budget = { min: Number(quotation.brief.budgetMin), max: Number(quotation.brief.budgetMax) };
  const lineItems = Array.isArray(quotation.lineItems)
    ? (quotation.lineItems as unknown as EditorLineItem[])
    : [];
  const views = await pricingEditorView(quotationId, user.id, budget);
  const recommendations = views
    .map((view) => view.recommendation)
    .filter((rec): rec is NonNullable<typeof rec> => rec !== null);

  return (
    <div>
      <PageHeader
        eyebrow="Quotation"
        title={quotation.brief.title}
        description="Every figure below is yours to change. The recommendation is advice beside the field, never above it."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={quotation.status} />
            <span>
              Client budget {formatMoney(budget.min)} – {formatMoney(budget.max)}
            </span>
            <span>{lineItems.length} line items</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/quotations/${quotationId}`} className={buttonClass("secondary", "md")}>
              View
            </Link>
            <Link href={`/briefs/${quotation.briefId}`} className={buttonClass("ghost", "md")}>
              Brief
            </Link>
          </div>
        }
      />

      <QuotationEditor
        quotationId={quotationId}
        briefId={quotation.briefId}
        status={quotation.status}
        briefBudget={budget}
        initialLineItems={lineItems.map((item) => ({
          description: item.description ?? "",
          price: typeof item.price === "number" ? item.price : Number(item.price) || 0,
        }))}
        initialTimelineDays={quotation.timelineDays}
        initialNotes={quotation.notes}
        recommendations={recommendations}
        regenerationsRemaining={Math.max(0, AI_MAX_REGENERATIONS - quotation.regenerationCount)}
      />
    </div>
  );
}
