import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Alert, buttonClass } from "@/components/ui";
import { PaymentReturn } from "./payment-return";

export const metadata: Metadata = { title: "Confirming payment" };

type Search = { searchParams: Promise<{ token?: string; outcome?: string }> };

/**
 * PayPal's `return_url` / `cancel_url` target (Orders v2 `experience_context`).
 *
 * PayPal appends `?token=<order id>&PayerID=…` after approval. Approval alone
 * moves no money, so this page hands the order to the capture endpoint, which
 * decides — server-side — whether the file unlocks. A cancelled approval just
 * returns the payer to checkout with nothing charged.
 */
export default async function PaymentReturnPage({ searchParams }: Search) {
  const { token, outcome } = await searchParams;
  const user = await requirePageSession(
    `/payments/return?${new URLSearchParams({ ...(token ? { token } : {}), ...(outcome ? { outcome } : {}) })}`,
  );

  const payment = token
    ? await prisma.payment.findUnique({
        where: { paypalOrderId: token },
        select: { milestoneId: true, clientId: true, status: true },
      })
    : null;

  // Unknown order, or someone else's: say nothing about it.
  if (!payment || payment.clientId !== user.id) {
    return (
      <Shell>
        <Alert tone="danger" title="We could not match this payment">
          This PayPal return link does not belong to a payment on your account. Nothing was captured.
        </Alert>
        <Link href="/delivery" className={buttonClass("primary", "md")}>
          Back to delivery
        </Link>
      </Shell>
    );
  }

  const checkoutUrl = `/delivery/${payment.milestoneId}/checkout`;

  if (payment.status === "CAPTURED") redirect(`/delivery/${payment.milestoneId}`);

  if (outcome === "cancelled") {
    return (
      <Shell>
        <Alert tone="info" title="Payment cancelled">
          You left PayPal before approving. Nothing was charged and the original file stays locked.
        </Alert>
        <Link href={checkoutUrl} className={buttonClass("primary", "md")}>
          Back to checkout
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <PaymentReturn orderId={token!} milestoneId={payment.milestoneId} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md space-y-4">{children}</div>
    </main>
  );
}
