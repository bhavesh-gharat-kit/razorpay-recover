/**
 * Typed environment loader/validator. Every other module reads config
 * through the `env` object exported here — nobody should call
 * `process.env` directly outside this file. Required vars throw a clear
 * error naming the missing variable as soon as this module is imported;
 * optional vars fall back to documented defaults.
 */

type NodeEnv = "development" | "production" | "test";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. Check .env against .env.example.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export const env = {
  NODE_ENV: optional("NODE_ENV", "development") as NodeEnv,
  PORT: optional("PORT", "3000"),

  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),

  // Email channel (Brevo) — required once Phase 6 sends real mail; not
  // enforced yet so Phase 0 boots without them configured.
  BREVO_API_KEY: optional("BREVO_API_KEY", ""),
  BREVO_SENDER_EMAIL: optional("BREVO_SENDER_EMAIL", ""),

  // Razorpay — required once Phase 2 ingests real webhook events.
  RAZORPAY_KEY_ID: optional("RAZORPAY_KEY_ID", ""),
  RAZORPAY_KEY_SECRET: optional("RAZORPAY_KEY_SECRET", ""),
  RAZORPAY_WEBHOOK_SECRET: optional("RAZORPAY_WEBHOOK_SECRET", ""),

  // Message generation — template-first by default.
  // LLM drafting is opt-in and off by default.
  USE_LLM_DRAFTING: optionalBoolean("USE_LLM_DRAFTING", false),
  ANTHROPIC_API_KEY: optional("ANTHROPIC_API_KEY", ""),

  // Internal task protection — shared secret for cron-triggered endpoints.
  INTERNAL_TASK_SECRET: optional("INTERNAL_TASK_SECRET", ""),

  // A real inbox that receives test recovery emails during manual QA
  // (scripts/test-send-email.ts). Empty in CI / production.
  TEST_RECIPIENT_EMAIL: optional("TEST_RECIPIENT_EMAIL", ""),

  // Checkout abandonment detection — minutes to wait before treating
  // an order as abandoned (default 30).
  CHECKOUT_ABANDONMENT_GRACE_MINUTES: parseInt(
    optional("CHECKOUT_ABANDONMENT_GRACE_MINUTES", "30"),
    10,
  ),

  // Orchestrator guardrails (Phase 4).
  MAX_CONTACTS_PER_CUSTOMER_PER_DAY: parseInt(
    optional("MAX_CONTACTS_PER_CUSTOMER_PER_DAY", "2"),
    10,
  ),

  // Human review threshold (Phase 7). Cases with amount at or above this
  // (in paise) require human approval before the orchestrator auto-sends.
  // Default: ₹5,000 = 500000 paise.
  HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE: parseInt(
    optional("HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE", "500000"),
    10,
  ),

  // Callback URL for Razorpay Payment Links — defaults to the app's own
  // webhook endpoint. Override in production with the public domain.
  RECOVERY_CALLBACK_URL: optional(
    "RECOVERY_CALLBACK_URL",
    `http://localhost:${optional("PORT", "3000")}/api/webhooks/razorpay`,
  ),
} as const;

if (env.USE_LLM_DRAFTING && !env.ANTHROPIC_API_KEY) {
  throw new Error(
    "USE_LLM_DRAFTING=true requires ANTHROPIC_API_KEY to be set.",
  );
}
