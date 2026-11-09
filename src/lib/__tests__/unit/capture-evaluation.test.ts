import { describe, expect, it } from "vitest";
import { evaluateCapture } from "@/lib/payments";
import { captureRequestId, parseCaptureResponse } from "@/lib/payments/paypal-client";

/**
 * Requirement 17.3/17.5 — what a PayPal capture response is allowed to mean.
 * These run against the pure decision, so every branch is exercised without a
 * network call or a database.
 */

const EXPECTED = { amount: "2000.00", currency: "USD" };

function response(capture: Record<string, unknown> | null, orderStatus = "COMPLETED") {
  return {
    id: "ORDER-1",
    status: orderStatus,
    purchase_units: [{ payments: { captures: capture ? [capture] : [] } }],
  };
}

const completed = {
  id: "CAP-1",
  status: "COMPLETED",
  amount: { currency_code: "USD", value: "2000.00" },
};

describe("parseCaptureResponse", () => {
  it("reads the capture's own status, id, amount and currency", () => {
    expect(parseCaptureResponse(response(completed))).toMatchObject({
      status: "COMPLETED",
      orderStatus: "COMPLETED",
      captureId: "CAP-1",
      amount: "2000.00",
      currency: "USD",
    });
  });

  it("does not let a COMPLETED order hide a PENDING capture", () => {
    const parsed = parseCaptureResponse(
      response({ ...completed, status: "PENDING", status_details: { reason: "RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION" } }),
    );
    expect(parsed.orderStatus).toBe("COMPLETED");
    expect(parsed.status).toBe("PENDING");
    expect(parsed.statusReason).toBe("RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION");
  });

  it("never invents an amount or currency PayPal did not send", () => {
    const parsed = parseCaptureResponse(response(null));
    expect(parsed.status).toBe("MISSING");
    expect(parsed.amount).toBeNull();
    expect(parsed.currency).toBeNull();
    expect(parsed.captureId).toBeNull();
  });

  it("survives a malformed body", () => {
    expect(parseCaptureResponse(undefined).status).toBe("MISSING");
    expect(parseCaptureResponse({ purchase_units: "nope" }).status).toBe("MISSING");
  });
});

describe("evaluateCapture", () => {
  it("captures only a COMPLETED capture with the exact amount and currency", () => {
    expect(evaluateCapture(parseCaptureResponse(response(completed)), EXPECTED)).toEqual({ kind: "CAPTURED" });
  });

  it("treats amount formatting differences as equal but a cent off as a mismatch", () => {
    const sameValue = { ...completed, amount: { currency_code: "USD", value: "2000" } };
    expect(evaluateCapture(parseCaptureResponse(response(sameValue)), EXPECTED).kind).toBe("CAPTURED");

    const centOff = { ...completed, amount: { currency_code: "USD", value: "1999.99" } };
    expect(evaluateCapture(parseCaptureResponse(response(centOff)), EXPECTED)).toMatchObject({
      kind: "REVIEW",
      reason: "AMOUNT_MISMATCH",
    });
  });

  it("flags the right amount in the wrong currency", () => {
    const euros = { ...completed, amount: { currency_code: "EUR", value: "2000.00" } };
    expect(evaluateCapture(parseCaptureResponse(response(euros)), EXPECTED)).toMatchObject({
      kind: "REVIEW",
      reason: "CURRENCY_MISMATCH",
    });
  });

  it("waits on a PENDING capture instead of unlocking or failing it", () => {
    const pending = { ...completed, status: "PENDING" };
    expect(evaluateCapture(parseCaptureResponse(response(pending)), EXPECTED)).toEqual({
      kind: "PENDING",
      reason: "CAPTURE_PENDING",
    });
  });

  it("fails DECLINED and FAILED captures", () => {
    for (const status of ["DECLINED", "FAILED"]) {
      const outcome = evaluateCapture(parseCaptureResponse(response({ ...completed, status })), EXPECTED);
      expect(outcome.kind).toBe("FAILED");
    }
  });

  it("sends a missing or incomplete capture to review", () => {
    expect(evaluateCapture(parseCaptureResponse(response(null)), EXPECTED)).toMatchObject({
      kind: "REVIEW",
      reason: "CAPTURE_MISSING",
    });
    const noId = { status: "COMPLETED", amount: { currency_code: "USD", value: "2000.00" } };
    expect(evaluateCapture(parseCaptureResponse(response(noId)), EXPECTED).kind).toBe("REVIEW");
    const unknown = { ...completed, status: "PARTIALLY_REFUNDED" };
    expect(evaluateCapture(parseCaptureResponse(response(unknown)), EXPECTED).kind).toBe("REVIEW");
  });
});

describe("PayPal-Request-Id", () => {
  it("gives the capture call its own stable id derived from the stored key", () => {
    expect(captureRequestId("idem-1")).toBe(captureRequestId("idem-1"));
    expect(captureRequestId("idem-1")).not.toBe("idem-1");
    expect(captureRequestId("idem-1").length).toBeLessThanOrEqual(108);
  });
});
