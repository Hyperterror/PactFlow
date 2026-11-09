import { handler, json } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { refreshPayout, toPayoutDto } from "@/lib/payouts";

type Params = { params: Promise<{ payoutId: string }> };

/** Re-reads the payout item status from PayPal. Client or Freelancer on the milestone. */
export const POST = handler(async (_req: Request, { params }: Params) => {
  const user = await requireSession();
  const { payoutId } = await params;
  return json({ payout: toPayoutDto(await refreshPayout(payoutId, user.id)) });
});
