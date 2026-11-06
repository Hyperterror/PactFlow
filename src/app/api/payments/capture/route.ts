import type { NextRequest } from "next/server";
import { z } from "zod";
import { handler, json, parseJson } from "@/lib/http";
import { requireSession } from "@/lib/auth/session";
import { capturePayment } from "@/lib/payments";
import { deliverGuaranteedInBackground } from "@/lib/notifications";
import { toPaymentDto } from "@/lib/serializers";

const CaptureSchema = z.object({
  paypalOrderId: z.string().min(1, "paypalOrderId is required."),
});

/**
 * Requirement 17.1/17.3 — captures the authorised order. The original file
 * stays locked on capture failure, non-COMPLETED status or amount mismatch.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireSession();
  const { paypalOrderId } = await parseJson(req, CaptureSchema);
  const result = await capturePayment(paypalOrderId, user.id);

  // The capture is already committed; delivering its notifications is the
  // transport's job, after the response is built, because guaranteed delivery
  // retries with backoff. The webhook receiver does the same thing.
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
