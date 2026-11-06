import { describe, expect, it } from "vitest";
import { daysUntil, formatBytes, formatDate, formatDateTime, formatMoney, humanize, truncate } from "@/lib/format";

describe("money formatting", () => {
  it("always shows two decimals", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(12)).toBe("$12.00");
  });

  it("accepts the Decimal-as-string form the API returns", () => {
    expect(formatMoney("1500.5")).toBe("$1,500.50");
  });

  it("renders a dash instead of NaN or a missing value", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney("not-a-number")).toBe("—");
  });

  it("honours the currency argument", () => {
    expect(formatMoney(10, "EUR")).toBe("€10.00");
    expect(formatMoney(10, "GBP")).toBe("£10.00");
  });
});

describe("date formatting", () => {
  it("formats in UTC regardless of the host time zone", () => {
    expect(formatDate("2026-01-05T23:30:00Z")).toBe("05 Jan 2026");
    expect(formatDateTime("2026-01-05T23:30:00Z")).toBe("05 Jan 2026, 23:30 UTC");
  });

  it("renders a dash for missing or invalid dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("misc formatting", () => {
  it("counts whole days from now", () => {
    const now = Date.now();
    const inTwoDays = new Date(now + 2 * 86_400_000);
    expect(daysUntil(inTwoDays)).toBe(2);
    expect(daysUntil(new Date(now - 86_400_000))).toBe(-1);
  });

  it("scales byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("turns an enum member into a label", () => {
    expect(humanize("UNDER_REVIEW")).toBe("Under Review");
    expect(humanize("PENDING_ACKNOWLEDGEMENT")).toBe("Pending Acknowledgement");
    expect(humanize(null)).toBe("—");
  });

  it("truncates with an ellipsis only when needed", () => {
    expect(truncate("abcdef", 6)).toBe("abcdef");
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abcdef", 0)).toBe("…");
  });
});
