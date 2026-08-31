/**
 * POST /api/demo/result
 *
 * Public, unauthenticated. Client callback from the /demo checkout page —
 * fires when Razorpay Checkout reports a `payment.failed` (outcome
 * "failed"), the visitor closes the modal in the abandonment scenario
 * (outcome "abandoned"), or the visitor dismisses without the abandoned
 * scenario intent (outcome "dismissed").
 *
 * In production the real `payment.failed` webhook is the authoritative
 * ingestion path — this endpoint is a belt-and-suspenders client callback
 * that lets the demo UI see the case appear even before Razorpay's
 * webhook lands. Idempotency on `razorpayRefId` (the payment id) means
 * only one of the two paths creates a case; the second one hands back
 * the same caseId.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { checkRateLimit, DEMO_RATE_LIMIT } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { fetchPayment } from "@/lib/razorpay/client";
import { handlePaymentFailed } from "@/lib/ingestion/handlers/payment-failed";
import { detectAbandonedCheckouts } from "@/lib/ingestion/detect-abandonment";
import { runDemoPipeline } from "@/lib/demo/pipeline";
import {
  DEMO_SOURCE_FAILED,
  DEMO_SOURCE_ABANDONED,
  getRequestIp,
  resolveDemoMerchant,
} from "@/lib/demo/shared";
import { OrderTrackingStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

interface RawPayload {
  demo?: boolean;
  [k: string]: unknown;
}

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request);
  const rl = checkRateLimit(`demo-result:${ip}`, DEMO_RATE_LIMIT);
  if (!rl.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many demo requests — try again in a few minutes",
      429,
    );
  }

  if (!env.RAZORPAY_KEY_ID) {
    return errorResponse(
      "RAZORPAY_NOT_CONFIGURED",
      "Live demo requires Razorpay test keys",
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_BODY", "Body must be valid JSON", 400);
  }

  const b = body as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" ? b.orderId : "";
  const paymentId = typeof b.paymentId === "string" ? b.paymentId : "";
  const outcome = b.outcome;

  if (!orderId) {
    return errorResponse("MISSING_ORDER_ID", "orderId is required", 400);
  }
  if (
    outcome !== "failed" &&
    outcome !== "abandoned" &&
    outcome !== "dismissed"
  ) {
    return errorResponse(
      "INVALID_OUTCOME",
      "outcome must be \"failed\", \"abandoned\", or \"dismissed\"",
      400,
    );
  }

  const orderTracking = await prisma.orderTracking.findUnique({
    where: { razorpayOrderId: orderId },
  });
  if (!orderTracking) {
    return errorResponse("ORDER_NOT_FOUND", `Order ${orderId} not found`, 404);
  }
  const raw = (orderTracking.rawPayload ?? {}) as RawPayload;
  if (raw.demo !== true) {
    // The order isn't a demo order — refuse to touch it from this public
    // endpoint even though we technically have its row.
    return errorResponse(
      "ORDER_NOT_FOUND",
      `Order ${orderId} not found`,
      404,
    );
  }

  const merchant = await resolveDemoMerchant();
  if (!merchant) {
    return errorResponse(
      "NO_DEMO_MERCHANT",
      "No merchant available for the demo",
      503,
    );
  }

  // -----------------------------------------------------------------
  // outcome: "dismissed" — modal closed, no scenario intent
  // -----------------------------------------------------------------
  if (outcome === "dismissed") {
    await prisma.orderTracking.update({
      where: { razorpayOrderId: orderId },
      data: { status: OrderTrackingStatus.FAILED },
    });
    return successResponse({ caseId: null });
  }

  // -----------------------------------------------------------------
  // outcome: "failed" — a real Razorpay payment.failed the client saw
  // -----------------------------------------------------------------
  if (outcome === "failed") {
    if (!paymentId) {
      return errorResponse(
        "MISSING_PAYMENT_ID",
        "paymentId is required for a failed outcome",
        400,
      );
    }

    // Idempotency FIRST — if the real webhook has beaten us, we don't
    // need to re-fetch the payment or re-run the pipeline. Both paths
    // (this route and the webhook dispatcher) key on `razorpayRefId` =
    // paymentId, so exactly one case exists per payment id.
    const dedupedEvent = await prisma.recoveryEvent.findUnique({
      where: { razorpayRefId: paymentId },
      include: { case: { select: { id: true, state: true } } },
    });
    if (dedupedEvent?.case) {
      return successResponse({
        caseId: dedupedEvent.case.id,
        state: dedupedEvent.case.state,
        deduped: true,
      });
    }

    // Fetch the real payment for error metadata. Don't hard-fail the
    // whole ingestion if the read fails — fall back to the OrderTracking
    // amount + generic error fields, log a warning, and proceed.
    const paymentResult = await fetchPayment(paymentId);
    let amountPaise = orderTracking.amountPaise;
    let currency = orderTracking.currency;
    let method: string | null = null;
    let email: string | null = orderTracking.customerEmail ?? null;
    let contact: string | null = orderTracking.customerPhone ?? null;
    let errorCode: string | null = "PAYMENT_FAILED";
    let errorDescription: string | null =
      "The payment did not complete successfully.";
    let errorSource: string | null = "customer";
    let errorStep: string | null = "payment_authorization";
    let errorReason: string | null = "payment_failed";
    let createdAt: number = Math.floor(Date.now() / 1000);

    if (paymentResult.ok) {
      amountPaise = paymentResult.amountPaise ?? amountPaise;
      currency = paymentResult.currency ?? currency;
      method = paymentResult.method;
      email = paymentResult.email ?? email;
      contact = paymentResult.contact ?? contact;
      errorCode = paymentResult.errorCode ?? errorCode;
      errorDescription = paymentResult.errorDescription ?? errorDescription;
      errorSource = paymentResult.errorSource ?? errorSource;
      errorStep = paymentResult.errorStep ?? errorStep;
      errorReason = paymentResult.errorReason ?? errorReason;
      createdAt = paymentResult.createdAt ?? createdAt;
    } else {
      logger.warn(
        { err: paymentResult.error, paymentId },
        "demo: fetchPayment failed — proceeding with fallback fields",
      );
    }

    // Build a canonical `payment.failed` webhook payload — same shape as
    // what the real Razorpay webhook receiver dispatches.
    const payload = {
      entity: "event",
      account_id: merchant.razorpayAccountId,
      event: "payment.failed",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            entity: "payment",
            amount: amountPaise,
            currency,
            status: "failed",
            order_id: orderId,
            method,
            email,
            contact,
            error_code: errorCode,
            error_description: errorDescription,
            error_source: errorSource,
            error_step: errorStep,
            error_reason: errorReason,
            created_at: createdAt,
          },
        },
      },
    };

    const handlerResult = await handlePaymentFailed(payload, paymentId);
    if (handlerResult.action !== "recovery_event_created" || !handlerResult.entityId) {
      return errorResponse(
        "INGESTION_SKIPPED",
        `Handler returned: ${handlerResult.action}`,
        422,
      );
    }
    const caseId = handlerResult.entityId;

    // Update the RecoveryEvent's sourceType to the demo marker so the
    // /api/demo/case/[id] read endpoint recognises this case.
    await prisma.recoveryEvent.updateMany({
      where: { case: { id: caseId } },
      data: { sourceType: DEMO_SOURCE_FAILED },
    });

    // Run the classify → decide → send pipeline synchronously so the
    // timeline the client polls has real steps in it within a few seconds.
    const pipelineResult = await runDemoPipeline(caseId);

    return successResponse({
      caseId,
      state: pipelineResult.finalState,
      steps: pipelineResult.steps,
    });
  }

  // -----------------------------------------------------------------
  // outcome: "abandoned" — visitor dismissed the modal on purpose
  // -----------------------------------------------------------------
  // Leave OrderTracking as CREATED and run the abandonment detector
  // scoped to just this order id with grace = 0 so it qualifies now.
  await detectAbandonedCheckouts({
    graceMinutesOverride: 0,
    razorpayOrderId: orderId,
  });

  // Find the case the detector just created. detect-abandonment's own
  // idempotency check uses the same JSON_UNQUOTE/JSON_EXTRACT expression
  // on `rawPayload.razorpayOrderId`, so this mirror-query is guaranteed
  // to match if the detector ran.
  const eventRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT re.id
    FROM RecoveryEvent re
    WHERE re.sourceType = 'abandonment_detection'
      AND JSON_UNQUOTE(JSON_EXTRACT(re.rawPayload, '$.razorpayOrderId')) = ${orderId}
    ORDER BY re.createdAt DESC
    LIMIT 1
  `;
  const eventRow = eventRows[0];
  const abandonedCase = eventRow
    ? await prisma.case.findFirst({
        where: { recoveryEventId: eventRow.id },
        include: { recoveryEvent: { select: { id: true } } },
      })
    : null;

  if (!abandonedCase) {
    return errorResponse(
      "ABANDONMENT_FAILED",
      "No case was created for this abandoned order",
      500,
    );
  }

  // Mark the RecoveryEvent as demo-originated for the read endpoint.
  await prisma.recoveryEvent.update({
    where: { id: abandonedCase.recoveryEvent.id },
    data: { sourceType: DEMO_SOURCE_ABANDONED },
  });

  const pipelineResult = await runDemoPipeline(abandonedCase.id);

  return successResponse({
    caseId: abandonedCase.id,
    state: pipelineResult.finalState,
    steps: pipelineResult.steps,
  });
}
