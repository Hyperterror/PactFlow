import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getMilestoneWithDeliverables } from "@/lib/milestones";
import { buttonClass, Card, CardBody, CardHeader, PageHeader, StatusBadge } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { CheckoutPanel } from "./checkout-panel";

type Params = { params: Promise<{ milestoneId: string }> };

export const metadata: Metadata = { title: "Checkout" };

/**
 * Requirement 16.5 — the checkout is a Client screen: the Freelancer is sent back
 * to the room, because only the payer can authorise an order.
 */
export default async function CheckoutPage({ params }: Params) {
  const user = await requirePageSession();
  const { milestoneId } = await params;

  const context = await getMilestoneWithDeliverables(milestoneId, user.id).catch(() => notFound());
  const { milestone, payment, agreement, role } = context;
  if (role !== "CLIENT") redirect(`/delivery/${milestoneId}`);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Checkout"
        title={milestone.name}
        description="One payment per milestone. The amount is fixed by the agreement, not by the delivery."
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <StatusBadge status={milestone.status} />
            <span>{formatMoney(Number(milestone.paymentAmount), agreement.currency)}</span>
            <span>Due {formatDate(milestone.dueDate)}</span>
            <span>Agreement version {agreement.currentVersion}</span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            <Link href={`/delivery/${milestoneId}`} className={buttonClass("secondary", "md")}>
              Delivery room
            </Link>
            <Link href={`/agreements/${milestone.agreementId}`} className={buttonClass("ghost", "md")}>
              Agreement
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Pay this milestone" description="Powered by PayPal Orders v2." />
          <CardBody>
            <CheckoutPanel
              milestoneId={milestoneId}
              amount={Number(milestone.paymentAmount)}
              currency={agreement.currency}
              milestoneStatus={milestone.status}
              payment={
                payment
                  ? {
                      id: payment.id,
                      status: payment.status,
                      approveUrl: payment.approveUrl,
                      orderId: payment.paypalOrderId,
                    }
                  : null
              }
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="What you are paying for" />
          <CardBody className="space-y-3 text-sm leading-relaxed">
            <p>{milestone.description}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Revision rounds included: {agreement.revisionLimit}</li>
              <li>The original file unlocks the moment the capture is confirmed.</li>
              <li>A failed capture leaves the file locked and the order retryable.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
