/**
 * Display formatting helpers.
 *
 * Every formatter pins the locale and the time zone so server-rendered markup
 * and client-rendered markup always agree (no hydration mismatches), and so a
 * timestamp shown in the UI is unambiguously UTC as the spec requires.
 */

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return `${DATE_TIME_FORMATTER.format(date)} UTC`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return DATE_FORMATTER.format(date);
}

export function formatMoney(amount: number | string | null | undefined, currency = "USD"): string {
  if (amount === null || amount === undefined) return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function daysUntil(value: Date | string): number {
  const date = typeof value === "string" ? new Date(value) : value;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

/** Human label for a SCREAMING_SNAKE enum member. */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}
