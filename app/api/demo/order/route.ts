/**
 * POST /api/demo/order
 *
 * Public, unauthenticated. Opens a Razorpay test-mode Order for the
 * /demo checkout page — the client then hands the returned `orderId` +
 * `keyId` to Razorpay Checkout to prompt the visitor for payment.
 *
 * We also stash an `OrderTracking` row keyed on the new order id so:
 *   - the abandonment scenario (`outcome: "abandoned"` on /api/demo/result)
 *     can find it via `detectAbandonedCheckouts({ razorpayOrderId })`; and
 *   - `payload.demo === true` is the marker `GET /api/demo/case/[id]`
 *     will look for (via the derived RecoveryEvent.sourceType) to keep
 *     the read endpoint from disclosing arbitrary internal cases.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { checkRateLimit, DEMO_RATE_LIMIT } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createOrder } from "@/lib/razorpay/client";
import {
  MIN_DEMO_AMOUNT_PAISE,
  MAX_DEMO_AMOUNT_PAISE,
  getRequestIp,
  resolveDemoMerchant,
} from "@/lib/demo/shared";
import { OrderTrackingStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  // --- Rate limit ---------------------------------------------------
  const ip = getRequestIp(request);
  const rl = checkRateLimit(`demo-order:${ip}`, DEMO_RATE_LIMIT);
  if (!rl.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many demo requests — try again in a few minutes",
      429,
    );
  }

  // --- Razorpay keys required for the live-checkout path -----------
  if (!env.RAZORPAY_KEY_ID) {
    return errorResponse(
      "RAZORPAY_NOT_CONFIGURED",
      "Live demo requires Razorpay test keys",
      503,
    );
  }

  // --- Parse + validate body ---------------------------------------
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_BODY", "Body must be valid JSON", 400);
  }

  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const amountPaise =
    typeof b.amountPaise === "number" ? Math.floor(b.amountPaise) : NaN;
  const scenario = b.scenario;

  if (!EMAIL_RE.test(email)) {
    return errorResponse("INVALID_EMAIL", "A valid email is required", 400);
  }

  if (
    !Number.isFinite(amountPaise) ||
    amountPaise < MIN_DEMO_AMOUNT_PAISE ||
    amountPaise > MAX_DEMO_AMOUNT_PAISE
  ) {
    return errorResponse(
      "INVALID_AMOUNT",
      `Amount must be between ${MIN_DEMO_AMOUNT_PAISE} and ${MAX_DEMO_AMOUNT_PAISE} paise (₹1–₹10,000)`,
      400,
    );
  }

  if (scenario !== "failed" && scenario !== "abandoned") {
    return errorResponse(
      "INVALID_SCENARIO",
      "scenario must be \"failed\" or \"abandoned\"",
      400,
    );
  }

  // --- Resolve the demo merchant -----------------------------------
  const merchant = await resolveDemoMerchant();
  if (!merchant) {
    return errorResponse(
      "NO_DEMO_MERCHANT",
      "No merchant available for the demo — seed the database first",
      503,
    );
  }

  // --- Ask Razorpay for a real Order --------------------------------
  const receipt = `demo_${Math.random().toString(36).slice(2, 10)}`;
  const orderResult = await createOrder({
    amountPaise,
    currency: "INR",
    receipt,
    notes: { demo: "true", scenario },
  });

  if (!orderResult.ok) {
    logger.error(
      { err: orderResult.error, statusCode: orderResult.statusCode },
      "demo: createOrder failed",
    );
    return errorResponse(
      "ORDER_CREATION_FAILED",
      orderResult.error,
      502,
    );
  }

  // --- Book the OrderTracking row for abandonment / demo-marker use -
  await prisma.orderTracking.upsert({
    where: { razorpayOrderId: orderResult.id },
    create: {
      razorpayOrderId: orderResult.id,
      merchantId: merchant.id,
      status: OrderTrackingStatus.CREATED,
      amountPaise,
      currency: "INR",
      customerEmail: email,
      customerPhone: "",
      rawPayload: {
        razorpayOrderId: orderResult.id,
        demo: true,
        scenario,
        name: name || null,
      },
    },
    update: {
      status: OrderTrackingStatus.CREATED,
      updatedAt: new Date(),
    },
  });

  return successResponse({
    orderId: orderResult.id,
    keyId: env.RAZORPAY_KEY_ID,
    amountPaise,
    currency: "INR",
    prefill: { email, name },
  });
}
