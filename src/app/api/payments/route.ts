import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson, parseQuery } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { getMilestoneForUser } from "@/lib/milestones";
import { getPaymentForMilestone, initiatePayment, listPaymentsForClient } from "@/lib/payments";
import { toPaymentDto } from "@/lib/serializers";

const QuerySchema = z.object({ milestoneId: z.string().min(1).optional() });

const InitiateSchema = z.object({ milestoneId: z.string().min(1, "milestoneId is required.") });

/** `?milestoneId=` returns that milestone's payment; otherwise the Client's list. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { milestoneId } = parseQuery(req, QuerySchema);

  if (milestoneId) {
    await getMilestoneForUser(milestoneId, user.id);
    const payment = await getPaymentForMilestone(milestoneId);
    return json({ payment: payment ? toPaymentDto(payment) : null });
  }

  const payments = await listPaymentsForClient(user.id);
  return json({ payments: payments.map(toPaymentDto) });
});

/**
 * Requirement 16.1 — initialises the PayPal order for an APPROVED milestone.
 * Repeated calls reuse the stored idempotency key and therefore the same order.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { milestoneId } = await parseJson(req, InitiateSchema);
  const { payment, approveUrl } = await initiatePayment(milestoneId, user.id);
  return json({ payment: toPaymentDto(payment), approveUrl }, 201);
});
