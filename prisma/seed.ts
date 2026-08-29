/**
 * Synthetic data generator for Recover.
 *
 * Generates reproducible, realistic checkout-drop-off data across 3
 * merchants so every later phase has something real to work against.
 *
 * Idempotent via wipe-and-reseed: truncates all tables in dependency
 * order, then reseeds from scratch. Safe for dev; never run against
 * production data.
 *
 * Usage:  npx prisma db seed
 *         (wired via package.json's prisma.seed field)
 */

import {
  PrismaClient,
  Scenario,
  Actor,
  CaseState,
  UserRole,
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Deterministic pseudo-random number generator (Mulberry32)
// — reproducible across runs for consistent seed data
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MERCHANTS = [
  {
    name: "QuickCart India",
    razorpayAccountId: "acc_QC1ndiaTest001",
    contactEmail: "ops@quickcart.in",
  },
  {
    name: "SubscribeSmart",
    razorpayAccountId: "acc_SubSmrt00002",
    contactEmail: "billing@subscribesmart.io",
  },
  {
    name: "BharatParts B2B",
    razorpayAccountId: "acc_BPartB2B0003",
    contactEmail: "finance@bharatparts.com",
  },
];

const FIRST_NAMES = [
  "Aarav",
  "Vivaan",
  "Aditya",
  "Vihaan",
  "Arjun",
  "Reyansh",
  "Sai",
  "Arnav",
  "Dhruv",
  "Kabir",
  "Ananya",
  "Diya",
  "Myra",
  "Sara",
  "Aadhya",
  "Isha",
  "Kiara",
  "Riya",
  "Priya",
  "Neha",
  "Rohan",
  "Karan",
  "Manish",
  "Suresh",
  "Rajesh",
  "Pooja",
  "Meera",
  "Sunita",
  "Deepak",
  "Amit",
];

const LAST_NAMES = [
  "Sharma",
  "Patel",
  "Gupta",
  "Singh",
  "Kumar",
  "Verma",
  "Joshi",
  "Reddy",
  "Nair",
  "Iyer",
  "Mehta",
  "Shah",
  "Bhat",
  "Rao",
  "Das",
];

const EMAIL_DOMAINS_CONSUMER = [
  "gmail.com",
  "yahoo.co.in",
  "rediffmail.com",
  "outlook.com",
  "hotmail.com",
];

const EMAIL_DOMAINS_B2B = [
  "steelworks.co.in",
  "autozone.in",
  "fabunit.com",
  "partsdepot.in",
];

const PAYMENT_METHODS = [
  "card",
  "card",
  "card",
  "upi",
  "upi",
  "netbanking",
  "wallet",
];

// Cause distribution (roughly):
// 30% insufficient funds, 25% card expired, 20% gateway timeout,
// 15% OTP abandoned, 10% ambiguous/free-text
interface CauseTemplate {
  errorCode: string;
  errorDescription: string;
  errorSource: string;
  errorStep: string;
}

const CAUSE_TEMPLATES: { weight: number; cause: CauseTemplate }[] = [
  {
    weight: 30,
    cause: {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "Your payment didn't go through as it was declined by the bank. Try another payment method or contact your bank.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
  },
  {
    weight: 25,
    cause: {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "The card is expired. Please try with another card or payment method.",
      errorSource: "customer",
      errorStep: "payment_authorization",
    },
  },
  {
    weight: 20,
    cause: {
      errorCode: "GATEWAY_ERROR",
      errorDescription:
        "Payment processing didn't complete on time. This is usually temporary — please retry.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
  },
  {
    weight: 15,
    cause: {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "Payment was cancelled by the user after redirect to bank OTP page.",
      errorSource: "customer",
      errorStep: "payment_authentication",
    },
  },
  // Ambiguous / free-text reasons — Phase 3's embedding fallback handles these
  {
    weight: 4,
    cause: {
      errorCode: "SERVER_ERROR",
      errorDescription:
        "We encountered an unexpected issue processing your payment. Please retry after some time.",
      errorSource: "internal",
      errorStep: "payment_processing",
    },
  },
  {
    weight: 3,
    cause: {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "Transaction declined due to risk check failure on issuer side.",
      errorSource: "bank",
      errorStep: "payment_authorization",
    },
  },
  {
    weight: 3,
    cause: {
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription:
        "Unable to process the payment. Card network reported authentication service unavailable.",
      errorSource: "bank",
      errorStep: "payment_authentication",
    },
  },
];

// Build a weighted array for easy picking
const WEIGHTED_CAUSES: CauseTemplate[] = [];
for (const { weight, cause } of CAUSE_TEMPLATES) {
  for (let i = 0; i < weight; i++) {
    WEIGHTED_CAUSES.push(cause);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generatePhone(): string {
  // Indian mobile: +91 followed by 10 digits starting with 6-9
  const firstDigit = pick(["6", "7", "8", "9"]);
  let rest = "";
  for (let i = 0; i < 9; i++) rest += Math.floor(rand() * 10).toString();
  return `+91${firstDigit}${rest}`;
}

function generateRazorpayOrderId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "order_";
  for (let i = 0; i < 14; i++) id += chars[Math.floor(rand() * chars.length)];
  return id;
}

function generateRazorpayPaymentId(): string | null {
  // Some failed payments never get a payment_id
  if (rand() < 0.3) return null;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "pay_";
  for (let i = 0; i < 14; i++) id += chars[Math.floor(rand() * chars.length)];
  return id;
}

function generateRazorpayId(prefix: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = `${prefix}_`;
  for (let i = 0; i < 14; i++) id += chars[Math.floor(rand() * chars.length)];
  return id;
}

/** A date `daysAgo` days in the past, at a random time of day. */
function daysAgoDate(daysAgo: number): Date {
  const now = new Date();
  const ms =
    now.getTime() -
    daysAgo * 24 * 60 * 60 * 1000 -
    randInt(0, 23) * 60 * 60 * 1000 -
    randInt(0, 59) * 60 * 1000;
  return new Date(ms);
}

function recentDate(daysAgo: number): Date {
  const now = new Date();
  const ms =
    now.getTime() -
    daysAgo * 24 * 60 * 60 * 1000 -
    randInt(0, 23) * 60 * 60 * 1000 -
    randInt(0, 59) * 60 * 1000;
  return new Date(ms);
}

function formatPaiseAsRupees(paise: number): string {
  const rupees = paise / 100;
  // Indian comma grouping: ₹1,00,000 not ₹100,000
  const parts = rupees.toFixed(2).split(".");
  const intPart = parts[0];
  const decPart = parts[1];

  // Apply Indian grouping: last 3 digits, then groups of 2
  if (intPart.length <= 3) return `₹${intPart}.${decPart}`;

  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `₹${grouped},${last3}.${decPart}`;
}

// ---------------------------------------------------------------------------
// Main seed logic
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "\n⚠  This will DELETE ALL existing data and reseed from scratch.\n",
  );

  // Wipe tables in dependency order (children first)
  await prisma.$transaction([
    prisma.deliveryAttempt.deleteMany(),
    prisma.draftMessage.deleteMany(),
    prisma.scheduledJob.deleteMany(),
    prisma.caseTransition.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.case.deleteMany(),
    prisma.classifiedCase.deleteMany(),
    prisma.recoveryEvent.deleteMany(),
    prisma.orderTracking.deleteMany(),
    prisma.recoveryPolicy.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.merchant.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log("  Existing data cleared.\n");

  // -------------------------------------------------------------------------
  // 1. Merchants
  // -------------------------------------------------------------------------
  const merchants = await Promise.all(
    MERCHANTS.map((m) => prisma.merchant.create({ data: m })),
  );
  console.log(`  Created ${merchants.length} merchants.`);

  // -------------------------------------------------------------------------
  // 2. Customers — ~30 spread across all 3 merchants
  // -------------------------------------------------------------------------
  const customersByMerchant: Record<string, { id: string; name: string; email: string; phone: string }[]> = {};
  for (const m of merchants) customersByMerchant[m.id] = [];

  // Merchant 1 (QuickCart) gets ~15, Merchant 2 gets ~8, Merchant 3 gets ~7
  const customerCounts = [15, 8, 7];
  const usedEmails = new Set<string>();

  for (let mi = 0; mi < merchants.length; mi++) {
    const merchant = merchants[mi];
    const count = customerCounts[mi];
    const isB2B = mi === 2;

    for (let ci = 0; ci < count; ci++) {
      const firstName = pick(FIRST_NAMES);
      const lastName = pick(LAST_NAMES);
      const domain = isB2B
        ? pick(EMAIL_DOMAINS_B2B)
        : pick(EMAIL_DOMAINS_CONSUMER);
      let email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;

      // Ensure uniqueness within this merchant
      const key = `${merchant.id}:${email}`;
      if (usedEmails.has(key)) {
        email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${ci}@${domain}`;
      }
      usedEmails.add(`${merchant.id}:${email}`);

      const customer = await prisma.customer.create({
        data: {
          merchantId: merchant.id,
          name: `${firstName} ${lastName}`,
          email,
          phone: generatePhone(),
        },
      });
      customersByMerchant[merchant.id].push({
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      });
    }
  }

  const totalCustomers = Object.values(customersByMerchant).reduce(
    (sum, arr) => sum + arr.length,
    0,
  );
  console.log(
    `  Created ${totalCustomers} customers (${customerCounts.map((c, i) => `${MERCHANTS[i].name}: ${c}`).join(", ")}).`,
  );

  // -------------------------------------------------------------------------
  // 3. RecoveryEvents — 55 checkout drop-off events for merchant #1
  // -------------------------------------------------------------------------
  const EVENT_COUNT = 55;
  const merchant1 = merchants[0];
  const m1Customers = customersByMerchant[merchant1.id];

  const causeCounts: Record<string, number> = {};
  let totalAmountPaise = 0;

  interface EventRecord {
    id: string;
    merchantId: string;
    customerId: string;
    amountPaise: number;
  }

  const events: EventRecord[] = [];

  for (let i = 0; i < EVENT_COUNT; i++) {
    const customer = pick(m1Customers);
    const cause = pick(WEIGHTED_CAUSES);
    const method = pick(PAYMENT_METHODS);
    const amountPaise = randInt(15000, 2500000); // ₹150 to ₹25,000
    const orderId = generateRazorpayOrderId();
    const paymentId = generateRazorpayPaymentId();
    const daysAgo = rand() * 7; // Spread over last 7 days
    const occurredAt = recentDate(daysAgo);

    // Track cause distribution
    const causeLabel =
      cause.errorDescription.includes("declined by the bank")
        ? "INSUFFICIENT_FUNDS"
        : cause.errorDescription.includes("expired")
          ? "CARD_EXPIRED"
          : cause.errorDescription.includes("didn't complete on time")
            ? "GATEWAY_TIMEOUT"
            : cause.errorDescription.includes("cancelled by the user")
              ? "OTP_ABANDONED"
              : "AMBIGUOUS";
    causeCounts[causeLabel] = (causeCounts[causeLabel] || 0) + 1;

    totalAmountPaise += amountPaise;

    // Realistic Razorpay payment.failed webhook payload shape
    const rawPayload = {
      entity: "event",
      account_id: merchant1.razorpayAccountId,
      event: "payment.failed",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            entity: "payment",
            amount: amountPaise,
            currency: "INR",
            status: "failed",
            order_id: orderId,
            method,
            description: `Order ${orderId}`,
            email: customer.email,
            contact: customer.phone,
            error_code: cause.errorCode,
            error_description: cause.errorDescription,
            error_source: cause.errorSource,
            error_step: cause.errorStep,
            error_reason: "payment_failed",
            created_at: Math.floor(occurredAt.getTime() / 1000),
          },
        },
      },
    };

    const event = await prisma.recoveryEvent.create({
      data: {
        merchantId: merchant1.id,
        customerId: customer.id,
        scenario: Scenario.CHECKOUT_DROPOFF,
        sourceType: "synthetic",
        rawPayload,
        amountPaise,
        currency: "INR",
        occurredAt,
      },
    });

    events.push({
      id: event.id,
      merchantId: event.merchantId,
      customerId: customer.id,
      amountPaise,
    });
  }

  console.log(`  Created ${events.length} RecoveryEvent records (all CHECKOUT_DROPOFF).`);

  // -------------------------------------------------------------------------
  // 4. Cases — one per event, all starting at DETECTED
  // -------------------------------------------------------------------------
  for (const event of events) {
    const caseRecord = await prisma.case.create({
      data: {
        recoveryEventId: event.id,
        merchantId: event.merchantId,
        customerId: event.customerId,
        state: CaseState.DETECTED,
        attemptCount: 0,
        maxAttempts: 3,
      },
    });

    // Initial transition
    await prisma.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: null,
        toState: CaseState.DETECTED,
        actor: Actor.SYSTEM,
        reasonCode: "event_ingested",
      },
    });
  }

  console.log(`  Created ${events.length} Case records (all DETECTED) with initial transitions.`);

  // -------------------------------------------------------------------------
  // 3b/4b. RecoveryEvents + Cases — subscription failures for merchant #2
  // (Phase 9). Distribution target: ~40% insufficient funds, ~35% lapsed
  // mandate (split across both rule paths — subscription.halted and
  // subscription.charged.failed with "mandate" wording — so both get
  // demoable coverage), ~25% expired mandate card.
  // -------------------------------------------------------------------------
  interface SubscriptionCauseTemplate {
    causeCode: "MANDATE_INSUFFICIENT_FUNDS" | "MANDATE_LAPSED" | "MANDATE_EXPIRED_CARD";
    event: "subscription.charged.failed" | "subscription.halted";
    errorCode?: string;
    errorDescription?: string;
  }

  // Exact stratified counts rather than weighted random picks — at N=28,
  // a probabilistic draw can land well off-target for the rarer causes;
  // fixed counts guarantee the documented ~40/35/25 split every run
  // (same approach as the invoice tier counts below).
  const SUBSCRIPTION_CAUSE_SPECS: { count: number; cause: SubscriptionCauseTemplate }[] = [
    {
      count: 11, // ~40% — insufficient funds
      cause: {
        causeCode: "MANDATE_INSUFFICIENT_FUNDS",
        event: "subscription.charged.failed",
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "The recurring charge could not be completed due to insufficient funds in the account.",
      },
    },
    {
      count: 7, // lapsed mandate via subscription.halted
      cause: { causeCode: "MANDATE_LAPSED", event: "subscription.halted" },
    },
    {
      count: 3, // lapsed mandate via subscription.charged.failed wording
      cause: {
        causeCode: "MANDATE_LAPSED",
        event: "subscription.charged.failed",
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "The mandate for this subscription has expired and needs to be re-authorized by the customer.",
      },
    }, // ^ combined with the row above: ~35% lapsed mandate
    {
      count: 7, // ~25% — expired mandate card
      cause: {
        causeCode: "MANDATE_EXPIRED_CARD",
        event: "subscription.charged.failed",
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "The card linked to this subscription has expired. Please add a new card to continue.",
      },
    },
  ];

  const SUBSCRIPTION_EVENT_COUNT = SUBSCRIPTION_CAUSE_SPECS.reduce((sum, s) => sum + s.count, 0);
  const merchant2 = merchants[1];
  const m2Customers = customersByMerchant[merchant2.id];
  const subscriptionCauseCounts: Record<string, number> = {};
  const subscriptionEvents: EventRecord[] = [];

  for (const spec of SUBSCRIPTION_CAUSE_SPECS) {
   for (let i = 0; i < spec.count; i++) {
    const customer = pick(m2Customers);
    const cause = spec.cause;
    const amountPaise = randInt(19900, 499900); // ₹199 to ₹4,999 (recurring plan)
    const occurredAt = recentDate(rand() * 10); // spread over last 10 days
    const subscriptionId = generateRazorpayId("sub");
    const planId = generateRazorpayId("plan");

    subscriptionCauseCounts[cause.causeCode] = (subscriptionCauseCounts[cause.causeCode] || 0) + 1;

    const subscriptionEntity = {
      id: subscriptionId,
      entity: "subscription",
      plan_id: planId,
      customer_id: generateRazorpayId("cust"),
      status: cause.event === "subscription.halted" ? "halted" : "active",
      current_start: Math.floor(occurredAt.getTime() / 1000) - 30 * 24 * 60 * 60,
      current_end: Math.floor(occurredAt.getTime() / 1000),
      paid_count: randInt(1, 11),
      total_count: 12,
      created_at: Math.floor(occurredAt.getTime() / 1000) - 90 * 24 * 60 * 60,
    };

    const rawPayload =
      cause.event === "subscription.halted"
        ? {
            entity: "event",
            account_id: merchant2.razorpayAccountId,
            event: "subscription.halted",
            contains: ["subscription"],
            payload: { subscription: { entity: subscriptionEntity } },
          }
        : {
            entity: "event",
            account_id: merchant2.razorpayAccountId,
            event: "subscription.charged.failed",
            contains: ["payment", "subscription"],
            payload: {
              payment: {
                entity: {
                  id: generateRazorpayPaymentId(),
                  entity: "payment",
                  amount: amountPaise,
                  currency: "INR",
                  status: "failed",
                  method: "card",
                  email: customer.email,
                  contact: customer.phone,
                  error_code: cause.errorCode,
                  error_description: cause.errorDescription,
                  created_at: Math.floor(occurredAt.getTime() / 1000),
                },
              },
              subscription: { entity: subscriptionEntity },
            },
          };

    const event = await prisma.recoveryEvent.create({
      data: {
        merchantId: merchant2.id,
        customerId: customer.id,
        scenario: Scenario.SUBSCRIPTION_FAILURE,
        sourceType: "synthetic",
        rawPayload,
        amountPaise,
        currency: "INR",
        occurredAt,
      },
    });

    subscriptionEvents.push({
      id: event.id,
      merchantId: event.merchantId,
      customerId: customer.id,
      amountPaise,
    });
   }
  }

  console.log(
    `  Created ${subscriptionEvents.length} RecoveryEvent records (all SUBSCRIPTION_FAILURE, merchant: ${merchant2.name}).`,
  );

  for (const event of subscriptionEvents) {
    const caseRecord = await prisma.case.create({
      data: {
        recoveryEventId: event.id,
        merchantId: event.merchantId,
        customerId: event.customerId,
        state: CaseState.DETECTED,
        attemptCount: 0,
        maxAttempts: 3,
      },
    });

    await prisma.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: null,
        toState: CaseState.DETECTED,
        actor: Actor.SYSTEM,
        reasonCode: "event_ingested",
      },
    });
  }

  console.log(`  Created ${subscriptionEvents.length} Case records (all DETECTED) with initial transitions.`);

  // -------------------------------------------------------------------------
  // 3c/4c. RecoveryEvents + Cases — overdue B2B invoices for merchant #3
  // (Phase 9). ~7 tier-1 (1-3 days overdue), ~7 tier-2 (4-10 days), ~6
  // tier-3 (11+ days) — see getEscalationTier() in lib/orchestrator/orchestrator.ts.
  // Two Cases get a promisedPaymentDate set (one already past, to show
  // escalation resuming; one in the future, to show it paused) — see
  // lib/orchestrator/orchestrator.ts's promise-to-pay guardrail.
  // -------------------------------------------------------------------------
  interface InvoiceTierSpec {
    tier: 1 | 2 | 3;
    count: number;
    minDaysOverdue: number;
    maxDaysOverdue: number;
  }

  const INVOICE_TIERS: InvoiceTierSpec[] = [
    { tier: 1, count: 7, minDaysOverdue: 1, maxDaysOverdue: 3 },
    { tier: 2, count: 7, minDaysOverdue: 4, maxDaysOverdue: 10 },
    { tier: 3, count: 6, minDaysOverdue: 11, maxDaysOverdue: 25 },
  ];

  const merchant3 = merchants[2];
  const m3Customers = customersByMerchant[merchant3.id];

  interface InvoiceEventRecord extends EventRecord {
    tier: 1 | 2 | 3;
  }

  const invoiceEvents: InvoiceEventRecord[] = [];
  let invoiceSeq = 1;

  for (const tierSpec of INVOICE_TIERS) {
    for (let i = 0; i < tierSpec.count; i++) {
      const customer = pick(m3Customers);
      const daysOverdue = randInt(tierSpec.minDaysOverdue, tierSpec.maxDaysOverdue);
      const dueDate = daysAgoDate(daysOverdue);
      const amountPaise = randInt(50000, 8000000); // ₹500 to ₹80,000 (B2B invoice)
      const invoiceId = generateRazorpayId("inv");
      const invoiceNumber = `INV-2026-${String(invoiceSeq).padStart(4, "0")}`;
      invoiceSeq++;

      const rawPayload = {
        entity: "event",
        account_id: merchant3.razorpayAccountId,
        // Production would ingest these via Razorpay's Invoice webhooks
        // (`invoice.expired` et al.); the buildathon simulates them
        // directly via seed data instead, per the Phase 9 build notes.
        event: "invoice.expired",
        contains: ["invoice"],
        payload: {
          invoice: {
            entity: {
              id: invoiceId,
              entity: "invoice",
              invoice_number: invoiceNumber,
              amount: amountPaise,
              currency: "INR",
              status: "expired",
              due_by: Math.floor(dueDate.getTime() / 1000),
              customer_details: {
                customer_name: customer.name,
                email: customer.email,
                contact: customer.phone,
              },
              created_at: Math.floor(dueDate.getTime() / 1000) - 30 * 24 * 60 * 60,
            },
          },
        },
      };

      const event = await prisma.recoveryEvent.create({
        data: {
          merchantId: merchant3.id,
          customerId: customer.id,
          scenario: Scenario.INVOICE_OVERDUE,
          sourceType: "synthetic",
          rawPayload,
          amountPaise,
          currency: "INR",
          occurredAt: dueDate,
          dueDate,
        },
      });

      invoiceEvents.push({
        id: event.id,
        merchantId: event.merchantId,
        customerId: customer.id,
        amountPaise,
        tier: tierSpec.tier,
      });
    }
  }

  console.log(
    `  Created ${invoiceEvents.length} RecoveryEvent records (all INVOICE_OVERDUE, merchant: ${merchant3.name}).`,
  );

  // Pick one tier-1 case for a future promise (pauses escalation) and one
  // tier-2 case for a past/expired promise (escalation should resume).
  const futurePromiseIndex = invoiceEvents.findIndex((e) => e.tier === 1);
  const pastPromiseIndex = invoiceEvents.findIndex((e) => e.tier === 2);

  for (let i = 0; i < invoiceEvents.length; i++) {
    const event = invoiceEvents[i];
    let promisedPaymentDate: Date | null = null;
    if (i === futurePromiseIndex) {
      promisedPaymentDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
    } else if (i === pastPromiseIndex) {
      promisedPaymentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago (expired)
    }

    const caseRecord = await prisma.case.create({
      data: {
        recoveryEventId: event.id,
        merchantId: event.merchantId,
        customerId: event.customerId,
        state: CaseState.DETECTED,
        attemptCount: 0,
        maxAttempts: 2,
        promisedPaymentDate,
      },
    });

    await prisma.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: null,
        toState: CaseState.DETECTED,
        actor: Actor.SYSTEM,
        reasonCode: "event_ingested",
      },
    });

    if (promisedPaymentDate) {
      await prisma.caseTransition.create({
        data: {
          caseId: caseRecord.id,
          fromState: CaseState.DETECTED,
          toState: CaseState.DETECTED,
          actor: Actor.HUMAN,
          reasonCode: "promise_to_pay_logged",
          metadata: { promisedPaymentDate: promisedPaymentDate.toISOString(), seeded: true },
        },
      });
    }
  }

  console.log(
    `  Created ${invoiceEvents.length} Case records (all DETECTED) with initial transitions ` +
      `(2 with promisedPaymentDate — one future, one past).`,
  );

  // -------------------------------------------------------------------------
  // 5. RecoveryPolicy — starter set for checkout drop-off causes
  // -------------------------------------------------------------------------
  const policies = [
    {
      scenario: Scenario.CHECKOUT_DROPOFF,
      causeCode: "INSUFFICIENT_FUNDS",
      allowedActions: ["RETRY_LINK", "REMINDER"],
      cooldownMinutes: 1440,
      maxAttempts: 2,
    },
    {
      scenario: Scenario.CHECKOUT_DROPOFF,
      causeCode: "CARD_EXPIRED",
      allowedActions: ["RETRY_LINK"],
      cooldownMinutes: 1440,
      maxAttempts: 2,
    },
    {
      scenario: Scenario.CHECKOUT_DROPOFF,
      causeCode: "GATEWAY_TIMEOUT",
      allowedActions: ["RETRY_LINK", "REMINDER"],
      cooldownMinutes: 60,
      maxAttempts: 3,
    },
    {
      scenario: Scenario.CHECKOUT_DROPOFF,
      causeCode: "OTP_ABANDONED",
      allowedActions: ["RETRY_LINK", "REMINDER"],
      cooldownMinutes: 1440,
      maxAttempts: 2,
    },
    {
      scenario: Scenario.CHECKOUT_DROPOFF,
      causeCode: "UNCLASSIFIED",
      allowedActions: ["RETRY_LINK"],
      cooldownMinutes: 2880,
      maxAttempts: 1,
    },

    // --- Subscription Failure (Phase 9) -----------------------------------
    {
      scenario: Scenario.SUBSCRIPTION_FAILURE,
      causeCode: "MANDATE_INSUFFICIENT_FUNDS",
      allowedActions: ["RETRY_LINK", "REMINDER"],
      cooldownMinutes: 2880, // 2 days — recurring charges are less urgent
      maxAttempts: 3,
    },
    {
      scenario: Scenario.SUBSCRIPTION_FAILURE,
      causeCode: "MANDATE_LAPSED",
      // Re-authorization, NOT a blind retry — retrying a lapsed mandate
      // just fails again the same way.
      allowedActions: ["RE_AUTH_LINK"],
      cooldownMinutes: 2880,
      maxAttempts: 2,
    },
    {
      scenario: Scenario.SUBSCRIPTION_FAILURE,
      causeCode: "MANDATE_EXPIRED_CARD",
      allowedActions: ["UPDATE_PAYMENT_METHOD"],
      cooldownMinutes: 2880,
      maxAttempts: 2,
    },

    // --- B2B Invoice Overdue (Phase 9) — graduated escalation -------------
    // Three rows share (scenario, causeCode) and are disambiguated by
    // escalationTier — see the doc comment on RecoveryPolicy in
    // prisma/schema.prisma and getEscalationTier() in orchestrator.ts.
    {
      scenario: Scenario.INVOICE_OVERDUE,
      causeCode: "INVOICE_OVERDUE",
      escalationTier: 1, // 1-3 days overdue
      allowedActions: ["FRIENDLY_NUDGE"],
      cooldownMinutes: 1440,
      maxAttempts: 2,
    },
    {
      scenario: Scenario.INVOICE_OVERDUE,
      causeCode: "INVOICE_OVERDUE",
      escalationTier: 2, // 4-10 days overdue
      allowedActions: ["FIRM_REMINDER"],
      cooldownMinutes: 2880,
      maxAttempts: 2,
    },
    {
      scenario: Scenario.INVOICE_OVERDUE,
      causeCode: "INVOICE_OVERDUE",
      escalationTier: 3, // 11+ days overdue — straight to a human
      allowedActions: ["ESCALATE_TO_HUMAN"],
      cooldownMinutes: 0,
      maxAttempts: 1,
    },
  ];

  for (const p of policies) {
    await prisma.recoveryPolicy.create({
      data: {
        ...p,
        sendWindowStartHour: 9,
        sendWindowEndHour: 21,
      },
    });
  }

  console.log(`  Created ${policies.length} RecoveryPolicy records.`);

  // -------------------------------------------------------------------------
  // 6. Users — one per role for demo/testing. Password is "recover123"
  //    for all three; change immediately in any real environment via
  //    `npm run create:admin`.
  // -------------------------------------------------------------------------
  const demoPassword = "recover123";
  const passwordHash = await bcrypt.hash(demoPassword, 12);

  const demoUsers = [
    { email: "admin@recover.local", role: UserRole.ADMIN },
    { email: "reviewer@recover.local", role: UserRole.REVIEWER },
    { email: "viewer@recover.local", role: UserRole.VIEWER },
  ];

  for (const u of demoUsers) {
    await prisma.user.create({
      data: { email: u.email, passwordHash, role: u.role },
    });
  }

  console.log(
    `  Created ${demoUsers.length} demo Users (password: "${demoPassword}"):`,
  );
  for (const u of demoUsers) {
    console.log(`    • ${u.email.padEnd(28)} ${u.role}`);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n━━━ Seed Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Merchants:  ${merchants.length}`);
  for (const m of merchants) {
    const custCount = customersByMerchant[m.id].length;
    console.log(`    • ${m.name} — ${custCount} customers`);
  }
  console.log(`  Customers:  ${totalCustomers} total`);
  console.log(
    `  Events:     ${events.length} CHECKOUT_DROPOFF (${merchant1.name}) + ` +
      `${subscriptionEvents.length} SUBSCRIPTION_FAILURE (${merchant2.name}) + ` +
      `${invoiceEvents.length} INVOICE_OVERDUE (${merchant3.name}) = ` +
      `${events.length + subscriptionEvents.length + invoiceEvents.length} total`,
  );
  console.log(
    `  Cases:      ${events.length + subscriptionEvents.length + invoiceEvents.length} (all DETECTED)`,
  );

  console.log("\n  Checkout Drop-off cause code distribution:");
  for (const [cause, count] of Object.entries(causeCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    const pct = ((count / EVENT_COUNT) * 100).toFixed(1);
    console.log(`    ${cause.padEnd(28)} ${String(count).padStart(3)} (${pct}%)`);
  }

  console.log("\n  Subscription Failure cause code distribution:");
  for (const [cause, count] of Object.entries(subscriptionCauseCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    const pct = ((count / SUBSCRIPTION_EVENT_COUNT) * 100).toFixed(1);
    console.log(`    ${cause.padEnd(28)} ${String(count).padStart(3)} (${pct}%)`);
  }

  console.log("\n  Invoice Overdue escalation tier distribution:");
  for (const tierSpec of INVOICE_TIERS) {
    const count = invoiceEvents.filter((e) => e.tier === tierSpec.tier).length;
    console.log(
      `    Tier ${tierSpec.tier} (${tierSpec.minDaysOverdue}-${tierSpec.maxDaysOverdue}d overdue)  ${String(count).padStart(3)}`,
    );
  }

  const totalAtRisk =
    totalAmountPaise +
    subscriptionEvents.reduce((sum, e) => sum + e.amountPaise, 0) +
    invoiceEvents.reduce((sum, e) => sum + e.amountPaise, 0);
  console.log(`\n  Total amount at risk (all scenarios): ${formatPaiseAsRupees(totalAtRisk)}\n`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
