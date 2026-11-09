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

/**
 * The capture as PayPal reported it. `status` is the status of the CAPTURE
 * (`purchase_units[0].payments.captures[0].status`), not the order: an order can
 * be COMPLETED while its capture is still PENDING or was DECLINED. `null` fields
 * mean PayPal did not send them — they are never defaulted, so a missing amount
 * can never compare equal to an expected one.
 */
export interface PayPalCapture {
  status: string;
  orderStatus: string;
  captureId: string | null;
  amount: string | null;
  currency: string | null;
  statusReason: string | null;
  raw: unknown;
}

interface CaptureResponseShape {
  status?: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        status_details?: { reason?: string };
        amount?: { currency_code?: string; value?: string };
      }>;
    };
  }>;
}

/** Reads the first capture out of an Orders v2 capture or order-details response. */
export function parseCaptureResponse(payload: unknown): PayPalCapture {
  const shape = (payload ?? {}) as CaptureResponseShape;
  const capture = shape.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: capture?.status ?? "MISSING",
    orderStatus: shape.status ?? "UNKNOWN",
    captureId: capture?.id ?? null,
    amount: capture?.amount?.value ?? null,
    currency: capture?.amount?.currency_code ?? null,
    statusReason: capture?.status_details?.reason ?? null,
    raw: payload,
  };
}

/**
 * Create and capture are different operations, so they get different
 * PayPal-Request-Id values. Both derive from the one key stored on the Payment
 * row, so every retry of either call still sends the same header value.
 */
export function captureRequestId(idempotencyKey: string): string {
  return `${idempotencyKey}-capture`;
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

/** Where PayPal sends the payer back after approving or cancelling. */
export function checkoutReturnUrls(): { returnUrl: string; cancelUrl: string } {
  return {
    returnUrl: `${env.appUrl}/payments/return`,
    cancelUrl: `${env.appUrl}/payments/return?outcome=cancelled`,
  };
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
  const { returnUrl, cancelUrl } = checkoutReturnUrls();
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
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "PactFlow",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
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
  // With `payment_source.paypal` PayPal names the approval link `payer-action`;
  // older integrations get `approve`. Either is the URL the payer must visit.
  const approve =
    payload.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href ?? "";
  if (!approve) {
    throw new PayPalError("PayPal order has no approval link", 502, payload);
  }
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
    return parseCaptureResponse({
      id: paypalOrderId,
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: `MOCKCAP-${randomUUID().replaceAll("-", "").slice(0, 17).toUpperCase()}`,
                status: "COMPLETED",
                amount: { currency_code: currency, value: amount },
              },
            ],
          },
        },
      ],
      _mock: true,
    });
  }

  const token = await getAccessToken();
  const response = await fetch(`${env.paypalBaseUrl}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "PayPal-Request-Id": captureRequestId(idempotencyKey),
      "Prefer": "return=representation",
    },
  });

  const payload = (await response.json().catch(() => ({}))) as {
    name?: string;
    details?: Array<{ issue?: string }>;
  };
  if (!response.ok) {
    // A capture that already went through (for example a retry after the first
    // response was lost) is answered with 422 ORDER_ALREADY_CAPTURED. The order
    // itself still carries the capture, so read it instead of failing.
    if (response.status === 422 && payload.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")) {
      return parseCaptureResponse(await getOrder(paypalOrderId));
    }
    throw new PayPalError("PayPal capture failed", response.status >= 500 ? 502 : response.status, payload);
  }
  return parseCaptureResponse(payload);
}

/** GET /v2/checkout/orders/{id} — the order with any captures it already holds. */
export async function getOrder(paypalOrderId: string): Promise<unknown> {
  const token = await getAccessToken();
  const response = await fetch(`${env.paypalBaseUrl}/v2/checkout/orders/${paypalOrderId}`, {
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new PayPalError("PayPal order lookup failed", 502, payload);
  }
  return payload;
}

/** Helper used by the mock approver page to keep the demo self-contained. */
export function isMockMode(): boolean {
  return !isRealPayPalEnabled();
}

// ─── Payouts (POST /v1/payments/payouts) ──────────────────────────────────────

export interface PayoutRequest {
  /** Unique per attempt; PayPal rejects a reused sender_batch_id for 30 days. */
  senderBatchId: string;
  receiverEmail: string;
  amount: string;
  currency: string;
  note: string;
}

/**
 * A payout batch as PayPal reports it. PactFlow sends exactly one item per
 * batch, so the first item's `transaction_status` is the payout's status. Item
 * fields are null until PayPal has processed the batch far enough to list it.
 */
export interface PayPalPayout {
  batchId: string;
  batchStatus: string;
  itemId: string | null;
  itemStatus: string | null;
  errorMessage: string | null;
  raw: unknown;
}

interface PayoutBatchShape {
  batch_header?: { payout_batch_id?: string; batch_status?: string };
  items?: Array<{
    payout_item_id?: string;
    transaction_status?: string;
    errors?: { name?: string; message?: string };
  }>;
}

export function parsePayoutBatch(payload: unknown): PayPalPayout {
  const shape = (payload ?? {}) as PayoutBatchShape;
  const item = shape.items?.[0];
  return {
    batchId: shape.batch_header?.payout_batch_id ?? "",
    batchStatus: shape.batch_header?.batch_status ?? "UNKNOWN",
    itemId: item?.payout_item_id ?? null,
    itemStatus: item?.transaction_status ?? null,
    errorMessage: item?.errors?.message ?? item?.errors?.name ?? null,
    raw: payload,
  };
}

function mockPayoutIds(senderBatchId: string): { batchId: string; itemId: string } {
  const digest = createHash("sha256").update(senderBatchId).digest("hex").toUpperCase();
  return { batchId: `MOCKPAYOUT-${digest.slice(0, 13)}`, itemId: `MOCKITEM-${digest.slice(13, 26)}` };
}

/** Mock outcome: SUCCESS unless PAYPAL_MOCK_PAYOUT_STATUS says otherwise (tests). */
function mockPayoutBatch(senderBatchId: string): PayPalPayout {
  const { batchId, itemId } = mockPayoutIds(senderBatchId);
  const status = (process.env.PAYPAL_MOCK_PAYOUT_STATUS ?? "").trim() || "SUCCESS";
  return parsePayoutBatch({
    batch_header: { payout_batch_id: batchId, batch_status: status === "SUCCESS" ? "SUCCESS" : "PROCESSING" },
    items: [
      {
        payout_item_id: itemId,
        transaction_status: status,
        ...(status === "FAILED" ? { errors: { name: "RECEIVER_UNREGISTERED", message: "Mock: receiver cannot accept payouts" } } : {}),
      },
    ],
    _mock: true,
  });
}

/**
 * Creates a one-item payout batch. `PayPal-Request-Id` is the sender batch id,
 * so a retry after a lost response returns the original batch instead of
 * paying twice.
 */
export async function createPayout(input: PayoutRequest): Promise<PayPalPayout> {
  if (!isRealPayPalEnabled()) return mockPayoutBatch(input.senderBatchId);

  const token = await getAccessToken();
  const response = await fetch(`${env.paypalBaseUrl}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "PayPal-Request-Id": input.senderBatchId,
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: "You have a PactFlow payout",
        email_message: input.note,
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: input.receiverEmail,
          amount: { value: input.amount, currency: input.currency },
          note: input.note,
          sender_item_id: input.senderBatchId,
        },
      ],
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new PayPalError("PayPal payout creation failed", response.status >= 500 ? 502 : response.status, payload);
  }
  return parsePayoutBatch(payload);
}

/** GET /v1/payments/payouts/{batch_id} — the batch with its item status. */
export async function getPayoutBatch(batchId: string, senderBatchId: string): Promise<PayPalPayout> {
  if (!isRealPayPalEnabled()) return mockPayoutBatch(senderBatchId);

  const token = await getAccessToken();
  const response = await fetch(`${env.paypalBaseUrl}/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new PayPalError("PayPal payout lookup failed", 502, payload);
  }
  return parsePayoutBatch(payload);
}
