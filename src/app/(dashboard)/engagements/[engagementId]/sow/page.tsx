import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { assertEngagementParticipant, getSowPreview } from "@/lib/engagements";
import { buttonClass, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { SowView } from "@/components/sow-view";
import { SowSubmit } from "./sow-submit";

type Params = { params: Promise<{ engagementId: string }> };

export const metadata: Metadata = { title: "Statement of Work" };

/**
 * Lifecycle Update PRD FR-06 — the SOW is derived from the approved
 * requirements version and the accepted proposal, with a traceability view and
 * any conflicts surfaced for a person to resolve.
 */
export default async function SowPage({ params }: Params) {
  const user = await requirePageSession();
  const { engagementId } = await params;
  const context = await assertEngagementParticipant(engagementId, user.id).catch(() => notFound());

  if (context.engagement.status === "AGREEMENT" && context.engagement.agreementId) {
    redirect(`/agreements/${context.engagement.agreementId}`);
  }
  if (context.engagement.status !== "REQUIREMENTS_APPROVED") {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Statement of Work" title="SOW not available yet" pillar="agreement" />
        <EmptyState
          title="Requirements are not approved"
          description="The SOW is generated once both parties approve the same requirements version."
          action={
            <Link href={`/engagements/${engagementId}/requirements`} className={buttonClass("primary", "md")}>
              Go to requirements
            </Link>
          }
        />
      </div>
    );
  }

  const { draft } = await getSowPreview(engagementId, user.id);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Statement of Work"
        title={draft.title}
        description="Scope comes from the approved requirements; price and timeline from the accepted proposal. Nothing here is invented."
        pillar="agreement"
        actions={
          <Link href={`/engagements/${engagementId}/requirements`} className={buttonClass("ghost", "md")}>
            Requirements v{draft.requirementsVersionNumber}
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="SOW preview" description="This is the text that becomes agreement version 1." />
          <CardBody>
            <SowView sow={draft} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Submit" description="Either party can submit. Both still approve the agreement." />
          <CardBody>
            <SowSubmit engagementId={engagementId} conflicts={draft.conflicts} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
