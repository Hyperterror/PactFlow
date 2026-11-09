import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { retryPayout, toPayoutDto } from "@/lib/payouts";

type Params = { params: Promise<{ payoutId: string }> };

/** Retries a failed payout with a fresh PayPal sender batch id. Freelancer only. */
export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireSession();
  const { payoutId } = await params;
  const { payout, reason } = await retryPayout(payoutId, user.id);
  return json({ payout: payout ? toPayoutDto(payout) : null, reason: reason ?? null });
});
