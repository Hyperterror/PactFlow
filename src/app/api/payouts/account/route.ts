import type { NextRequest } from "next/server";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PayoutAccountSchema, setPayoutAccount } from "@/lib/payouts";

/** The caller's own PayPal payout email. */
export const GET = handler(async () => {
  const user = await requireSession();
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { paypalPayoutEmail: true } });
  return json({ paypalPayoutEmail: row.paypalPayoutEmail });
});

/** Sets the payout email and releases any payout that was waiting for it. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { paypalPayoutEmail } = await parseJson(req, PayoutAccountSchema);
  return json(await setPayoutAccount(user.id, paypalPayoutEmail));
});
