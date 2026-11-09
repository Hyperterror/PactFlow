/**
 * Typed environment configuration.
 *
 * Every optional integration degrades to a fully functional local
 * implementation so the platform can be run and demoed without external
 * credentials. Setting the real credentials switches the driver over.
 */

function flag(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

export const env = {
  appUrl: flag(process.env.APP_URL, "http://localhost:3000"),
  isProduction: process.env.NODE_ENV === "production",

  // Storage
  storageDriver: (flag(process.env.STORAGE_DRIVER, "local") === "s3" ? "s3" : "local") as "s3" | "local",
  localStorageDir: flag(process.env.LOCAL_STORAGE_DIR, ".data/storage"),
  storageSigningSecret: flag(process.env.STORAGE_SIGNING_SECRET, "pactflow-dev-signing-secret"),
  s3Endpoint: flag(process.env.S3_ENDPOINT),
  s3Region: flag(process.env.S3_REGION, "us-east-1"),
  s3AccessKey: flag(process.env.S3_ACCESS_KEY),
  s3SecretKey: flag(process.env.S3_SECRET_KEY),
  s3Bucket: flag(process.env.S3_BUCKET, "pactflow-deliverables"),

  // PayPal
  paypalMode: (flag(process.env.PAYPAL_MODE, "mock") === "sandbox" ? "sandbox" : "mock") as
    | "sandbox"
    | "mock",
  paypalClientId: flag(process.env.PAYPAL_CLIENT_ID),
  paypalClientSecret: flag(process.env.PAYPAL_CLIENT_SECRET),
  paypalBaseUrl: flag(process.env.PAYPAL_BASE_URL, "https://api-m.sandbox.paypal.com"),
  paypalWebhookId: flag(process.env.PAYPAL_WEBHOOK_ID),
  // Mock-mode HMAC secret only. Sandbox mode verifies through PayPal and needs
  // PAYPAL_WEBHOOK_ID; production refuses this default (see webhooks/verifier).
  paypalWebhookSecret: flag(process.env.PAYPAL_WEBHOOK_SECRET, "pactflow-dev-webhook-secret"),

  // Share of each captured milestone payment kept by the platform before the
  // Freelancer payout, in percent (0–50). 0 pays the Freelancer the full amount.
  platformFeePercent: Math.min(50, Math.max(0, Number(flag(process.env.PLATFORM_FEE_PERCENT, "0")) || 0)),

  // LLM
  llmApiKey: flag(process.env.LLM_API_KEY),
  llmBaseUrl: flag(process.env.LLM_BASE_URL, "https://api.openai.com/v1"),
  llmModel: flag(process.env.LLM_MODEL, "gpt-4o-mini"),

  // Operator escalation target for guaranteed notification delivery failures
  operatorAlertWebhook: flag(process.env.OPERATOR_ALERT_WEBHOOK),

  // Shared secret for the scheduled job endpoint. When empty, the endpoint only
  // accepts an authenticated platform operator.
  cronSecret: flag(process.env.CRON_SECRET),
} as const;

let warnedAboutSandboxFallback = false;

/** True when the real PayPal Orders v2 Sandbox API should be called. */
export function isRealPayPalEnabled(): boolean {
  const enabled = env.paypalMode === "sandbox" && env.paypalClientId !== "" && env.paypalClientSecret !== "";
  // Asking for Sandbox without credentials silently ran the simulator before,
  // which makes a demo look live when it is not. Say so once, loudly.
  if (env.paypalMode === "sandbox" && !enabled && !warnedAboutSandboxFallback) {
    warnedAboutSandboxFallback = true;
    console.warn(
      "[paypal] PAYPAL_MODE=sandbox but PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are empty — using the local mock checkout instead of PayPal Sandbox.",
    );
  }
  return enabled;
}

/** True when a real LLM endpoint should be called. */
export function isRealLLMEnabled(): boolean {
  return env.llmApiKey !== "";
}
