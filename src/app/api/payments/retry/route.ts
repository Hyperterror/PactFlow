import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { retryCapture } from "@/lib/payments";
import { deliverGuaranteedInBackground } from "@/lib/notifications";
import { toPaymentDto } from "@/lib/serializers";

const RetrySchema = z.object({ paymentId: z.string().min(1, "paymentId is required.") });

/**
 * Requirement 17.2 — a retry reuses the persisted idempotency key so PayPal can
 * never capture the same order twice.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { paymentId } = await parseJson(req, RetrySchema);
  const result = await retryCapture(paymentId, user.id);

  // Same split as the capture endpoint: deliver after the response is built.
  if (result.notificationIds?.length) {
    deliverGuaranteedInBackground(result.notificationIds);
  }

  return json({
    payment: toPaymentDto(result.payment),
    captured: result.captured,
    reviewRequired: result.reviewRequired,
    reason: result.reason ?? null,
  });
});
