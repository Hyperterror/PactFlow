import { describe, expect, it } from "vitest";
import { computePayoutSplit, mapPayoutItemStatus } from "@/lib/payouts";
import { parsePayoutBatch } from "@/lib/payments/paypal-client";

describe("computePayoutSplit", () => {
  it("pays the full amount with no fee", () => {
    expect(computePayoutSplit(2000, 0)).toEqual({ fee: 0, amount: 2000 });
  });

  it("rounds the fee to cents and keeps fee + amount equal to the gross", () => {
    const { fee, amount } = computePayoutSplit(1999.99, 5);
    expect(fee).toBe(100);
    expect(amount).toBe(1899.99);
    expect(Math.round((fee + amount) * 100)).toBe(199999);
  });

  it("clamps the fee to 0–50 percent", () => {
    expect(computePayoutSplit(100, 90)).toEqual({ fee: 50, amount: 50 });
    expect(computePayoutSplit(100, -5)).toEqual({ fee: 0, amount: 100 });
  });
});

describe("mapPayoutItemStatus", () => {
  it("maps PayPal transaction statuses to payout states", () => {
    expect(mapPayoutItemStatus("SUCCESS")).toBe("SUCCEEDED");
    expect(mapPayoutItemStatus("UNCLAIMED")).toBe("UNCLAIMED");
    for (const failed of ["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "REVERSED", "CANCELED"]) {
      expect(mapPayoutItemStatus(failed)).toBe("FAILED");
    }
    for (const pending of ["PENDING", "ONHOLD", "NEW", null, undefined]) {
      expect(mapPayoutItemStatus(pending)).toBe("PENDING");
    }
  });
});

describe("parsePayoutBatch", () => {
  it("reads the batch header and the first item", () => {
    const parsed = parsePayoutBatch({
      batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS" },
      items: [{ payout_item_id: "ITEM1", transaction_status: "SUCCESS" }],
    });
    expect(parsed).toMatchObject({ batchId: "BATCH1", batchStatus: "SUCCESS", itemId: "ITEM1", itemStatus: "SUCCESS" });
  });

  it("leaves item fields null when PayPal has not listed the item yet", () => {
    const parsed = parsePayoutBatch({ batch_header: { payout_batch_id: "BATCH2", batch_status: "PENDING" } });
    expect(parsed.itemId).toBeNull();
    expect(parsed.itemStatus).toBeNull();
  });
});
