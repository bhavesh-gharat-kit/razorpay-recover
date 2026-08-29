/**
 * POST /api/webhooks/razorpay
 *
 * Razorpay webhook receiver. Verifies the HMAC-SHA256 signature over the
 * raw request body, dispatches to the appropriate event handler, and
 * guarantees idempotency via the Razorpay event's own ID.
 *
 * Important: we read the raw body via `request.text()` FIRST, then
 * `JSON.parse` after verifying — Next.js App Router requires this order
 * for signature verification to be correct.
 */

import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { successResponse, errorResponse } from "@/lib/api/response";
import { verifyRazorpaySignature } from "@/lib/ingestion/verify-signature";
import { eventHandlers } from "@/lib/ingestion/handlers";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

  // 1. Read raw body for signature verification.
  const rawBody = await request.text();

  // 2. Verify signature.
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyRazorpaySignature(rawBody, signature, webhookSecret)) {
    const sourceIp =
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      "unknown";
    logger.error(
      { sourceIp },
      "webhook signature verification failed",
    );
    return errorResponse("INVALID_SIGNATURE", "Signature verification failed", 401);
  }

  // 3. Parse the payload.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return errorResponse("INVALID_PAYLOAD", "Malformed JSON body", 400);
  }

  // 4. Extract event type and event ID.
  const eventType = payload.event as string | undefined;
  if (!eventType) {
    return errorResponse("MISSING_EVENT_TYPE", "No event type in payload", 400);
  }

  // Razorpay's top-level `id` field is the canonical event ID.
  // Fall back to the payment/order entity ID if missing.
  const eventId =
    (payload.id as string) ??
    ((payload as Record<string, Record<string, Record<string, Record<string, string>>>>)
      ?.payload?.payment?.entity?.id) ??
    ((payload as Record<string, Record<string, Record<string, Record<string, string>>>>)
      ?.payload?.order?.entity?.id);

  if (!eventId) {
    return errorResponse("MISSING_EVENT_ID", "No event ID in payload", 400);
  }

  // 5. Idempotency check — has this event already been processed?
  const existing = await prisma.recoveryEvent.findUnique({
    where: { razorpayRefId: eventId },
  });
  if (existing) {
    return successResponse({
      action: "duplicate_ignored",
      eventId,
    });
  }

  // 6. Dispatch to the appropriate handler.
  const handler = eventHandlers[eventType];
  if (!handler) {
    // Unrecognized event type — return 200 so Razorpay doesn't retry.
    return successResponse({
      action: "event_type_not_handled",
      eventType,
    });
  }

  try {
    const result = await handler(
      payload as Record<string, unknown>,
      eventId,
    );
    return successResponse({ eventType, eventId, ...result });
  } catch (error) {
    logger.error({ err: error, eventType }, "webhook handler failed");
    Sentry.captureException(error);
    return errorResponse(
      "HANDLER_ERROR",
      `Failed to process ${eventType} event`,
      500,
    );
  }
}
