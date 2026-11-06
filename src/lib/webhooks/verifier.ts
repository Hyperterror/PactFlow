import { createHmac, timingSafeEqual } from "node:crypto";
import { env, isRealPayPalEnabled } from "@/lib/env";
import { getAccessToken } from "@/lib/payments/paypal-client";

export interface SignatureHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

export function extractSignatureHeaders(headers: Headers): SignatureHeaders {
  return {
    transmissionId: headers.get("paypal-transmission-id") ?? "",
    transmissionTime: headers.get("paypal-transmission-time") ?? "",
    transmissionSig: headers.get("paypal-transmission-sig") ?? "",
    certUrl: headers.get("paypal-cert-url") ?? "",
    authAlgo: headers.get("paypal-auth-algo") ?? "",
  };
}

/**
 * Local signature scheme used when no PayPal webhook id is configured.
 * The Sandbox notification service is replaced by an HMAC over the raw body
 * keyed with PAYPAL_WEBHOOK_SECRET so signature rejection stays testable.
 */
export function computeDevSignature(rawBody: string, secret = env.paypalWebhookSecret): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Requirement 18.2 — verify the event signature before touching any payload.
 * Uses PayPal's verify-webhook-signature API when Sandbox credentials and a
 * webhook id are configured, and the local HMAC scheme otherwise.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
): Promise<VerificationResult> {
  const signature = extractSignatureHeaders(headers);

  if (isRealPayPalEnabled() && env.paypalWebhookId) {
    if (!signature.transmissionId || !signature.transmissionSig) {
      return { valid: false, reason: "Missing PayPal transmission headers." };
    }
    try {
      const token = await getAccessToken();
      const response = await fetch(`${env.paypalBaseUrl}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          transmission_id: signature.transmissionId,
          transmission_time: signature.transmissionTime,
          cert_url: signature.certUrl,
          auth_algo: signature.authAlgo,
          transmission_sig: signature.transmissionSig,
          webhook_id: env.paypalWebhookId,
          webhook_event: JSON.parse(rawBody),
        }),
      });
      const payload = (await response.json()) as { verification_status?: string };
      const valid = response.ok && payload.verification_status === "SUCCESS";
      return valid ? { valid } : { valid, reason: payload.verification_status ?? "verification failed" };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : "verification error" };
    }
  }

  const provided = signature.transmissionSig || headers.get("x-pactflow-signature") || "";
  if (!provided) return { valid: false, reason: "Missing signature header." };
  const expected = computeDevSignature(rawBody);
  return safeEqual(expected, provided)
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch." };
}
