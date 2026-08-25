/**
 * Brevo live-send smoke test — sends one real recovery-style email through
 * the Brevo adapter so you can confirm the integration actually works
 * before relying on it during a demo.
 *
 * Usage:  npm run test:send-email
 *
 * Requires BREVO_API_KEY, BREVO_SENDER_EMAIL, and TEST_RECIPIENT_EMAIL to
 * be set in .env. Sends a sample recovery message and prints the result —
 * check both the recipient inbox AND the Brevo dashboard
 * (https://app.brevo.com/transactional) for delivery confirmation.
 */

import { env } from "../lib/env";
import { brevoEmailAdapter } from "../lib/channels/brevoEmailAdapter";
import { formatAmountINR } from "../lib/messaging/formatAmount";

async function main() {
  if (!env.TEST_RECIPIENT_EMAIL) {
    console.error(
      "TEST_RECIPIENT_EMAIL is not set in .env — add a real inbox you can check.",
    );
    process.exit(1);
  }

  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    console.error(
      "BREVO_API_KEY / BREVO_SENDER_EMAIL are not set in .env — Brevo send will fail.",
    );
    process.exit(1);
  }

  const merchantName = "Test Merchant Co.";
  const amount = formatAmountINR(184300, "INR");
  const recoveryLink = "https://rzp.io/i/test-recovery-link";

  const body = [
    "Hi there,",
    "",
    `We noticed your payment of ${amount} to ${merchantName} didn't go through.`,
    "No worries — you can complete it securely using the link below.",
    "",
    recoveryLink,
    "",
    "If you've already paid, please ignore this message.",
  ].join("\n");

  console.log(`Sending test email to ${env.TEST_RECIPIENT_EMAIL} via Brevo...`);

  const result = await brevoEmailAdapter.send({
    channel: "EMAIL",
    to: { email: env.TEST_RECIPIENT_EMAIL, name: "Test Recipient" },
    subject: `Action needed: complete your payment to ${merchantName}`,
    body,
    metadata: { caseId: "smoke_test", merchantName },
  });

  console.log("Brevo adapter result:", result);

  if (result.status === "SENT") {
    console.log(`\n✅ Sent. Brevo messageId: ${result.providerRef}`);
    console.log(
      `Check the inbox at ${env.TEST_RECIPIENT_EMAIL} AND the Brevo dashboard ` +
        "(https://app.brevo.com/transactional) to confirm delivery.",
    );
  } else {
    console.error(`\n❌ Failed: ${result.errorDetail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
