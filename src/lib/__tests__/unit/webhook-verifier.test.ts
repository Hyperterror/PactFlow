import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { computeDevSignature, extractSignatureHeaders, verifyWebhookSignature } from "@/lib/webhooks/verifier";

const RAW_BODY = JSON.stringify({
  id: "WH-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource: { id: "MOCK-123", status: "COMPLETED" },
});

describe("webhook signature (Requirement 18.2)", () => {
  it("computes an HMAC over the raw body", () => {
    const expected = createHmac("sha256", "unit-test-secret").update(RAW_BODY).digest("base64");
    expect(computeDevSignature(RAW_BODY, "unit-test-secret")).toBe(expected);
  });

  it("is deterministic and secret-dependent", () => {
    expect(computeDevSignature(RAW_BODY, "a")).toBe(computeDevSignature(RAW_BODY, "a"));
    expect(computeDevSignature(RAW_BODY, "a")).not.toBe(computeDevSignature(RAW_BODY, "b"));
  });

  it("changes when the body changes", () => {
    const tampered = RAW_BODY.replace("COMPLETED", "DENIED");
    expect(computeDevSignature(tampered, "a")).not.toBe(computeDevSignature(RAW_BODY, "a"));
  });

  it("reads the transmission headers case-insensitively", () => {
    const headers = new Headers({
      "PayPal-Transmission-Id": "tid",
      "PayPal-Transmission-Time": "2026-01-01T00:00:00Z",
      "PayPal-Transmission-Sig": "sig",
      "PayPal-Cert-Url": "https://example.test/cert",
      "PayPal-Auth-Algo": "SHA256withRSA",
    });
    expect(extractSignatureHeaders(headers)).toEqual({
      transmissionId: "tid",
      transmissionTime: "2026-01-01T00:00:00Z",
      transmissionSig: "sig",
      certUrl: "https://example.test/cert",
      authAlgo: "SHA256withRSA",
    });
  });

  it("defaults missing headers to empty strings instead of throwing", () => {
    expect(extractSignatureHeaders(new Headers()).transmissionId).toBe("");
    expect(extractSignatureHeaders(new Headers()).authAlgo).toBe("");
  });

  it("accepts a correctly signed body in local mode", async () => {
    const headers = new Headers({ "x-pactflow-signature": computeDevSignature(RAW_BODY) });
    await expect(verifyWebhookSignature(RAW_BODY, headers)).resolves.toEqual({ valid: true });
  });

  it("rejects a mismatched signature", async () => {
    const headers = new Headers({ "x-pactflow-signature": computeDevSignature(RAW_BODY, "wrong-secret") });
    const result = await verifyWebhookSignature(RAW_BODY, headers);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Signature mismatch.");
  });

  it("rejects a missing signature outright", async () => {
    const result = await verifyWebhookSignature(RAW_BODY, new Headers());
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing signature header.");
  });
});
