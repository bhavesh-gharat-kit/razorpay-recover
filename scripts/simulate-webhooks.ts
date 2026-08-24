/**
 * Webhook simulator — generates realistic Razorpay webhook payloads,
 * signs them with the webhook secret, and POSTs them to the local
 * webhook endpoint.
 *
 * Usage:  npm run simulate:webhooks
 *
 * Sends a burst of events plus deliberate duplicates to prove
 * idempotency holds.
 */

import { createHmac } from "crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = process.env.WEBHOOK_URL ?? "http://localhost:3000";
const WEBHOOK_SECRET =
  process.env.RAZORPAY_WEBHOOK_SECRET ??
  'whsec_test_secret_for_dev_only_32chars!';
const ENDPOINT = `${BASE_URL}/api/webhooks/razorpay`;

// Use the first merchant's account ID from the seed data.
const MERCHANT_ACCOUNT_ID = "acc_QC1ndiaTest001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomId(prefix: string, length = 14): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix;
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function randomEmail(): string {
  const names = [
    "aarav.sharma",
    "vivaan.patel",
    "diya.gupta",
    "sara.singh",
    "rohan.kumar",
    "priya.verma",
    "amit.joshi",
    "neha.reddy",
    "deepak.nair",
    "meera.iyer",
  ];
  return `${names[Math.floor(Math.random() * names.length)]}@gmail.com`;
}

function randomPhone(): string {
  const first = ["6", "7", "8", "9"][Math.floor(Math.random() * 4)];
  let rest = "";
  for (let i = 0; i < 9; i++) rest += Math.floor(Math.random() * 10).toString();
  return `+91${first}${rest}`;
}

// ---------------------------------------------------------------------------
// Payload generators
// ---------------------------------------------------------------------------

interface GeneratedEvent {
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

function generatePaymentFailed(): GeneratedEvent {
  const eventId = randomId("evt_");
  const paymentId = randomId("pay_");
  const orderId = randomId("order_");
  const amount = Math.floor(Math.random() * 2000000) + 15000;

  const causes = [
    {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "Your payment didn't go through as it was declined by the bank.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
    {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "The card is expired. Please try with another card.",
      errorSource: "customer",
      errorStep: "payment_authorization",
    },
    {
      errorCode: "GATEWAY_ERROR",
      errorDescription:
        "Payment processing didn't complete on time. Please retry.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
    {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "Payment was cancelled by the user after redirect to bank OTP page.",
      errorSource: "customer",
      errorStep: "payment_authentication",
    },
  ];

  const cause = causes[Math.floor(Math.random() * causes.length)];
  const email = randomEmail();
  const phone = randomPhone();

  return {
    eventId,
    eventType: "payment.failed",
    payload: {
      entity: "event",
      account_id: MERCHANT_ACCOUNT_ID,
      event: "payment.failed",
      contains: ["payment"],
      id: eventId,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            entity: "payment",
            amount,
            currency: "INR",
            status: "failed",
            order_id: orderId,
            method: ["card", "upi", "netbanking"][
              Math.floor(Math.random() * 3)
            ],
            description: `Order ${orderId}`,
            email,
            contact: phone,
            error_code: cause.errorCode,
            error_description: cause.errorDescription,
            error_source: cause.errorSource,
            error_step: cause.errorStep,
            error_reason: "payment_failed",
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    },
  };
}

function generateOrderPaid(): GeneratedEvent {
  const eventId = randomId("evt_");
  const orderId = randomId("order_");
  const amount = Math.floor(Math.random() * 2000000) + 15000;

  return {
    eventId,
    eventType: "order.paid",
    payload: {
      entity: "event",
      account_id: MERCHANT_ACCOUNT_ID,
      event: "order.paid",
      contains: ["order"],
      id: eventId,
      payload: {
        order: {
          entity: {
            id: orderId,
            entity: "order",
            amount,
            currency: "INR",
            status: "paid",
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
    },
  };
}

function generatePaymentLinkPaid(): GeneratedEvent {
  const eventId = randomId("evt_");
  const paymentLinkId = randomId("plink_");
  const paymentId = randomId("pay_");
  const amount = Math.floor(Math.random() * 2000000) + 15000;

  return {
    eventId,
    eventType: "payment_link.paid",
    payload: {
      entity: "event",
      account_id: MERCHANT_ACCOUNT_ID,
      event: "payment_link.paid",
      contains: ["payment_link", "payment"],
      id: eventId,
      payload: {
        payment_link: {
          entity: {
            id: paymentLinkId,
            entity: "payment_link",
            amount,
            currency: "INR",
            status: "paid",
          },
        },
        payment: {
          entity: {
            id: paymentId,
            entity: "payment",
            amount,
            currency: "INR",
            status: "captured",
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface SendResult {
  eventId: string;
  eventType: string;
  status: number;
  body: unknown;
  isDuplicate: boolean;
}

async function sendEvent(
  event: GeneratedEvent,
  isDuplicate = false,
): Promise<SendResult> {
  const bodyStr = JSON.stringify(event.payload);
  const signature = sign(bodyStr, WEBHOOK_SECRET);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": signature,
    },
    body: bodyStr,
  });

  const body = await res.json();
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    status: res.status,
    body,
    isDuplicate,
  };
}

async function main() {
  console.log("\n🚀 Razorpay Webhook Simulator");
  console.log(`   Target: ${ENDPOINT}`);
  console.log("━".repeat(60));

  // Generate events
  const events: GeneratedEvent[] = [];

  // 10 payment.failed events
  for (let i = 0; i < 10; i++) events.push(generatePaymentFailed());

  // 5 order.paid events
  for (let i = 0; i < 5; i++) events.push(generateOrderPaid());

  // 3 payment_link.paid events (won't match any cases yet)
  for (let i = 0; i < 3; i++) events.push(generatePaymentLinkPaid());

  // Pick 3 events to duplicate (for idempotency testing)
  const duplicateIndices = [0, 4, 7];
  const duplicates = duplicateIndices.map((i) => events[i]);

  console.log(
    `\n📤 Sending ${events.length} unique events + ${duplicates.length} duplicates...\n`,
  );

  const results: SendResult[] = [];

  // Send all unique events first
  for (const event of events) {
    const result = await sendEvent(event);
    results.push(result);
    const status = result.status === 200 ? "✅" : "❌";
    console.log(
      `  ${status} ${result.eventType.padEnd(20)} ${result.eventId.substring(0, 20)}... → ${result.status}`,
    );
  }

  console.log("\n📤 Sending duplicates...\n");

  // Send duplicates
  for (const event of duplicates) {
    const result = await sendEvent(event, true);
    results.push(result);
    const status = result.status === 200 ? "✅" : "❌";
    const action =
      (result.body as Record<string, Record<string, string>>)?.data?.action ??
      "unknown";
    console.log(
      `  ${status} ${result.eventType.padEnd(20)} ${result.eventId.substring(0, 20)}... → ${result.status} (${action})`,
    );
  }

  // Also test with an invalid signature
  console.log("\n🔐 Testing invalid signature...\n");

  const badEvent = generatePaymentFailed();
  const badBodyStr = JSON.stringify(badEvent.payload);
  const badRes = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-razorpay-signature": "invalid_signature_hex",
    },
    body: badBodyStr,
  });
  const badBody = await badRes.json();
  const badStatus = badRes.status === 401 ? "✅" : "❌";
  console.log(
    `  ${badStatus} Invalid signature → ${badRes.status} (expected 401)`,
  );

  // Missing signature
  const missingRes = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: badBodyStr,
  });
  const missingStatus = missingRes.status === 401 ? "✅" : "❌";
  console.log(
    `  ${missingStatus} Missing signature → ${missingRes.status} (expected 401)`,
  );

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("\n━".repeat(60));
  console.log("📊 Summary");
  console.log("━".repeat(60));

  const unique = results.filter((r) => !r.isDuplicate);
  const dupes = results.filter((r) => r.isDuplicate);

  const uniqueOk = unique.filter((r) => r.status === 200).length;
  const dupesIgnored = dupes.filter(
    (r) =>
      r.status === 200 &&
      (r.body as Record<string, Record<string, string>>)?.data?.action ===
        "duplicate_ignored",
  ).length;

  console.log(`  Unique events sent:     ${unique.length}`);
  console.log(`  Unique events accepted: ${uniqueOk}`);
  console.log(`  Duplicates sent:        ${dupes.length}`);
  console.log(`  Duplicates ignored:     ${dupesIgnored}`);
  console.log(`  Invalid sig rejected:   ${badRes.status === 401 ? "yes" : "no"}`);
  console.log(`  Missing sig rejected:   ${missingRes.status === 401 ? "yes" : "no"}`);

  const byType: Record<string, number> = {};
  for (const r of unique) {
    byType[r.eventType] = (byType[r.eventType] || 0) + 1;
  }
  console.log("\n  By event type:");
  for (const [type, count] of Object.entries(byType)) {
    console.log(`    ${type.padEnd(24)} ${count}`);
  }

  console.log("");

  // Exit with error if anything unexpected happened
  if (
    uniqueOk !== unique.length ||
    dupesIgnored !== dupes.length ||
    badRes.status !== 401
  ) {
    console.error("❌ Some checks failed — see output above.");
    process.exit(1);
  }

  console.log("✅ All checks passed!\n");
}

main().catch((err) => {
  console.error("Simulator failed:", err);
  process.exit(1);
});
