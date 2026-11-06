import { createHash, randomUUID } from "node:crypto";
import { env, isRealPayPalEnabled } from "@/lib/env";

/**
 * PayPal Orders v2 client.
 *
 * In `mock` mode (the default when no Sandbox credentials are configured) the
 * same shapes are produced locally so the full payment lifecycle can be demoed
 * without network access. Setting PAYPAL_MODE=sandbox plus client credentials
 * routes every call to the real Sandbox API.
 */

export interface PayPalOrder {
  id: string;
  status: string;
  approveUrl: string;
  raw: unknown;
}

export interface PayPalCapture {
  status: string;
  amount: string;
  currency: string;
  raw: unknown;
}

export interface CreateOrderInput {
  amount: string;
  currency: string;
  referenceId: string;
  idempotencyKey: string;
  description?: string;
}

export class PayPalError extends Error {
  readonly status: number;
  readonly payload: unknown;
  constructor(message: string, status = 502, payload: unknown = null) {
    super(message);
    this.name = "PayPalError";
    this.status = status;
    this.payload = payload;
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function credentials(): string {
  return Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
}

/** OAuth 2.0 client-credentials token with in-memory caching. */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const response = await fetch(`${env.paypalBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!response.ok || !payload.access_token) {
    throw new PayPalError("PayPal authentication failed", 502, payload);
  }
  cachedToken = {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 300) * 1000,
  };
  return payload.access_token;
}

export function resetTokenCache(): void {
  cachedToken = null;
}

function mockOrderId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 17).toUpperCase();
  return `MOCK-${digest}`;
}

function mockCaptureAmount(input: { amount: string }): string {
  const override = process.env.PAYPAL_MOCK_CAPTURE_AMOUNT;
  return override && override.trim() !== "" ? override.trim() : input.amount;
}

export async function createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
  if (!isRealPayPalEnabled()) {
    const id = mockOrderId(input.idempotencyKey);
    return {
      id,
      status: "CREATED",
      approveUrl: `${env.appUrl}/payments/mock-approve?token=${id}`,
      raw: {
        id,
        status: "CREATED",
        intent: "CAPTURE",
        purchase_units: [
          { reference_id: input.referenceId, amount: { currency_code: input.currency, value: input.amount } },
        ],
        links: [
          { href: `${env.appUrl}/payments/mock-approve?token=${id}`, rel: "approve", method: "GET" },
        ],
        _mock: true,
      },
    };
  }

  const token = await getAccessToken();
  const response = await fetch(`${env.paypalBaseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      // Requirement 16.2 — same key is reused on retry, never regenerated.
      "PayPal-Request-Id": input.idempotencyKey,
      "Prefer": "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.referenceId,
          description: input.description ?? "PactFlow milestone payment",
          amount: { currency_code: input.currency, value: input.amount },
        },
      ],
      application_context: {
        brand_name: "PactFlow",
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      },
    }),
  });

  const payload = (await response.json()) as {
    id?: string;
    status?: string;
    links?: Array<{ href: string; rel: string }>;
  };
  if (!response.ok || !payload.id) {
    throw new PayPalError("PayPal order creation failed", 502, payload);
  }
  const approve = payload.links?.find((link) => link.rel === "approve")?.href ?? "";
  return {
    id: payload.id,
    status: payload.status ?? "CREATED",
    approveUrl: approve,
    raw: payload,
  };
}

export async function captureOrder(
  paypalOrderId: string,
  idempotencyKey: string,
  expected?: { amount: string; currency: string },
): Promise<PayPalCapture> {
  if (!isRealPayPalEnabled()) {
    const amount = mockCaptureAmount({ amount: expected?.amount ?? "0.00" });
    const currency = expected?.currency ?? "USD";
    return {
      status: "COMPLETED",
      amount,
      currency,
      raw: {
        id: paypalOrderId,
        status: "COMPLETED",
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: `CAPTURE-${randomUUID().slice(0, 8).toUpperCase()}`,
                  status: "COMPLETED",
                  amount: { currency_code: currency, value: amount },
                },
              ],
            },
          },
        ],
        _mock: true,
      },
    };
  }

  const token = await getAccessToken();
  const response = await fetch(`${env.paypalBaseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "PayPal-Request-Id": idempotencyKey,
    },
  });

  const payload = (await response.json()) as {
    status?: string;
    purchase_units?: Array<{
      payments?: { captures?: Array<{ amount?: { currency_code?: string; value?: string } }> };
    }>;
  };
  if (!response.ok) {
    throw new PayPalError("PayPal capture failed", 502, payload);
  }
  const capture = payload.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: payload.status ?? "UNKNOWN",
    amount: capture?.amount?.value ?? "0.00",
    currency: capture?.amount?.currency_code ?? "USD",
    raw: payload,
  };
}

/** Helper used by the mock approver page to keep the demo self-contained. */
export function isMockMode(): boolean {
  return !isRealPayPalEnabled();
}
