/**
 * Shared helpers for the public /api/demo/** routes: source-type markers,
 * IP extraction, amount bounds, merchant resolution.
 *
 * All the demo endpoints are unauthenticated (they're the live-demo
 * checkout flow — a judge should be able to try them without an account),
 * so the guards here are the whole trust boundary between random public
 * traffic and the internal recovery pipeline.
 */

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { Scenario } from "@prisma/client";
import type { NextRequest } from "next/server";

/**
 * `RecoveryEvent.sourceType` values for events originated by the /demo
 * flow. `GET /api/demo/case/[id]` filters on these to prevent the public
 * endpoint being used to read arbitrary internal cases.
 */
export const DEMO_SOURCE_FAILED = "demo_checkout";
export const DEMO_SOURCE_ABANDONED = "demo_abandonment";

export const DEMO_SOURCE_TYPES = [
  DEMO_SOURCE_FAILED,
  DEMO_SOURCE_ABANDONED,
] as const;

/**
 * Server-side amount cap on the /demo endpoints. Client-side is
 * enforced too, but this is the authoritative check — a hand-crafted
 * request must respect it.
 *   min: ₹1  (100 paise) — Razorpay's minimum
 *   max: ₹10,000 (1,000,000 paise) — arbitrary demo ceiling
 */
export const MIN_DEMO_AMOUNT_PAISE = 100;
export const MAX_DEMO_AMOUNT_PAISE = 1_000_000;

/**
 * Extract the caller's IP from standard proxy headers, falling back to
 * the string `"unknown"` so the rate-limiter key is always defined.
 * Same header chain as the webhook route.
 */
export function getRequestIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Resolve the merchant the demo should book cases against. Prefers the
 * merchant whose `razorpayAccountId` matches `env.RAZORPAY_ACCOUNT_ID`
 * (so real test-mode webhooks that carry the same account_id land on
 * the same merchant); falls back to the first seeded CHECKOUT_DROPOFF
 * merchant when the env is unset. Returns `null` if neither yields a
 * merchant — caller renders a 503.
 */
export async function resolveDemoMerchant() {
  if (env.RAZORPAY_ACCOUNT_ID) {
    const byAccount = await prisma.merchant.findFirst({
      where: { razorpayAccountId: env.RAZORPAY_ACCOUNT_ID },
    });
    if (byAccount) return byAccount;
  }
  // Fallback — the seed always creates a CHECKOUT_DROPOFF merchant first
  // (QuickCart India), so we hand back whichever merchant is oldest.
  return prisma.merchant.findFirst({
    where: {
      recoveryEvents: { some: { scenario: Scenario.CHECKOUT_DROPOFF } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Mask an email for read-only public display: `j••@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const shown = local.slice(0, 1);
  return `${shown}••${domain}`;
}

/** Case states we treat as terminal for the /demo polling UI. */
export const TERMINAL_DEMO_STATES = new Set([
  "RECOVERED",
  "ACTION_SENT",
  "CLOSED",
  "ESCALATED",
]);
