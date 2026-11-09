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
  /**
   * True when the signature could not be checked at all (PayPal unreachable or
   * answering 5xx). The receiver answers 503 so PayPal retries the delivery,
   * instead of recording a genuine event as forged.
   */
  retryable?: boolean;
}

/** The default HMAC secret is public in the repository; it is a dev-only value. */
export const DEV_WEBHOOK_SECRET = "pactflow-dev-webhook-secret";

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
 *
 * Sandbox mode always uses PayPal's verify-webhook-signature API and refuses to
 * run without PAYPAL_WEBHOOK_ID: falling back to the local HMAC there would let
 * anyone who knows the secret mark real orders as paid. The local HMAC scheme
 * exists for mock mode only, and in production it refuses the public default.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
): Promise<VerificationResult> {
  const signature = extractSignatureHeaders(headers);

  if (isRealPayPalEnabled()) {
    if (!env.paypalWebhookId) {
      console.error("[webhook] PAYPAL_MODE=sandbox but PAYPAL_WEBHOOK_ID is not set; rejecting delivery");
      return { valid: false, reason: "PAYPAL_WEBHOOK_ID is not configured." };
    }
    if (!signature.transmissionId || !signature.transmissionSig) {
      return { valid: false, reason: "Missing PayPal transmission headers." };
    }
    let webhookEvent: unknown;
    try {
      webhookEvent = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: "Payload was not valid JSON." };
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
          webhook_event: webhookEvent,
        }),
      });
      if (response.status >= 500 || response.status === 429) {
        return { valid: false, retryable: true, reason: `PayPal verification unavailable (${response.status})` };
      }
      const payload = (await response.json().catch(() => ({}))) as { verification_status?: string };
      const valid = response.ok && payload.verification_status === "SUCCESS";
      return valid ? { valid } : { valid, reason: payload.verification_status ?? "verification failed" };
    } catch (error) {
      // Network failure or an auth outage: the signature was never judged.
      return {
        valid: false,
        retryable: true,
        reason: error instanceof Error ? error.message : "verification error",
      };
    }
  }

  if (env.isProduction && env.paypalWebhookSecret === DEV_WEBHOOK_SECRET) {
    return { valid: false, reason: "PAYPAL_WEBHOOK_SECRET is the public development default." };
  }

  const provided = signature.transmissionSig || headers.get("x-pactflow-signature") || "";
  if (!provided) return { valid: false, reason: "Missing signature header." };
  const expected = computeDevSignature(rawBody);
  return safeEqual(expected, provided)
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch." };
}
