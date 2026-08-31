/**
 * Checkout abandonment detection.
 *
 * Queries OrderTracking for orders with status CREATED and createdAt older
 * than CHECKOUT_ABANDONMENT_GRACE_MINUTES. For each, creates a RecoveryEvent
 * (scenario CHECKOUT_DROPOFF, cause hint OTP_ABANDONED, sourceType
 * "abandonment_detection") and a Case in DETECTED state.
 *
 * NOTE: Phase 4's worker will call this function directly (imported, not
 * via HTTP) on every cron tick.
 */

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  Scenario,
  CaseState,
  Actor,
  OrderTrackingStatus,
} from "@prisma/client";
import { emitCaseTransition } from "@/lib/events/emit";

export interface AbandonmentResult {
  /** Total CREATED orders past the grace window. */
  checkedCount: number;
  /** New Cases created for abandoned checkouts. */
  createdCount: number;
  /** Orders skipped (already had a RecoveryEvent). */
  skippedCount: number;
}

export interface AbandonmentOptions {
  /**
   * When set, overrides `env.CHECKOUT_ABANDONMENT_GRACE_MINUTES`. The
   * live-demo /api/demo/result route passes `0` so a just-created order
   * qualifies as abandoned immediately — without this, an "Abandoned
   * checkout" demo run would sit idle for the default 30 minutes before
   * anything happened. The worker's cron loop uses the default.
   */
  graceMinutesOverride?: number;
  /**
   * When set, restrict the scan to this single Razorpay order id — the
   * demo route uses this so a demo run never accidentally sweeps in
   * unrelated real CREATED orders that happen to be older than the
   * grace window. The worker passes nothing (scans everything).
   */
  razorpayOrderId?: string;
}

export async function detectAbandonedCheckouts(
  options: AbandonmentOptions = {},
): Promise<AbandonmentResult> {
  const graceMinutes =
    options.graceMinutesOverride ?? env.CHECKOUT_ABANDONMENT_GRACE_MINUTES;
  const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);

  // Find CREATED orders older than the grace window.
  const abandonedOrders = await prisma.orderTracking.findMany({
    where: {
      status: OrderTrackingStatus.CREATED,
      createdAt: { lte: cutoff },
      ...(options.razorpayOrderId
        ? { razorpayOrderId: options.razorpayOrderId }
        : {}),
    },
    include: {
      merchant: true,
    },
  });

  let createdCount = 0;
  let skippedCount = 0;

  for (const order of abandonedOrders) {
    // Check if we already have a RecoveryEvent for this order.
    // We use a raw query to check the rawPayload JSON for the order ID,
    // since it's embedded in the payload structure.
    const existingEvents = await prisma.$queryRaw<{ cnt: bigint }[]>`
      SELECT COUNT(*) as cnt
      FROM RecoveryEvent re
      WHERE re.sourceType = 'abandonment_detection'
        AND JSON_UNQUOTE(JSON_EXTRACT(re.rawPayload, '$.razorpayOrderId')) = ${order.razorpayOrderId}
    `;

    if (existingEvents[0] && Number(existingEvents[0].cnt) > 0) {
      skippedCount++;
      continue;
    }

    // Find or create a customer for this order.
    let customer = order.customerEmail
      ? await prisma.customer.findUnique({
          where: {
            merchantId_email: {
              merchantId: order.merchantId,
              email: order.customerEmail,
            },
          },
        })
      : null;

    if (!customer && order.customerEmail) {
      customer = await prisma.customer.create({
        data: {
          merchantId: order.merchantId,
          name: order.customerEmail.split("@")[0],
          email: order.customerEmail,
          phone: order.customerPhone ?? "",
        },
      });
    }

    if (!customer) {
      // Can't create a recovery case without customer info.
      skippedCount++;
      continue;
    }

    // Create RecoveryEvent, Case, CaseTransition, and AuditLog.
    await prisma.$transaction(async (tx) => {
      const recoveryEvent = await tx.recoveryEvent.create({
        data: {
          merchantId: order.merchantId,
          customerId: customer!.id,
          scenario: Scenario.CHECKOUT_DROPOFF,
          sourceType: "abandonment_detection",
          rawPayload: {
            razorpayOrderId: order.razorpayOrderId,
            amountPaise: order.amountPaise,
            currency: order.currency,
            customerEmail: order.customerEmail,
            customerPhone: order.customerPhone,
            causeHint: "OTP_ABANDONED",
            detectedAt: new Date().toISOString(),
          },
          amountPaise: order.amountPaise,
          currency: order.currency,
          occurredAt: order.createdAt,
        },
      });

      const caseRecord = await tx.case.create({
        data: {
          recoveryEventId: recoveryEvent.id,
          merchantId: order.merchantId,
          customerId: customer!.id,
          state: CaseState.DETECTED,
          attemptCount: 0,
          maxAttempts: 2,
        },
      });

      await tx.caseTransition.create({
        data: {
          caseId: caseRecord.id,
          fromState: null,
          toState: CaseState.DETECTED,
          actor: Actor.SYSTEM,
          reasonCode: "abandonment_detected",
        },
      });

      await tx.auditLog.create({
        data: {
          entityType: "Case",
          entityId: caseRecord.id,
          actor: Actor.SYSTEM,
          action: "abandonment_detected",
          reasonCode: "abandonment_detected",
          afterState: {
            caseId: caseRecord.id,
            state: CaseState.DETECTED,
            recoveryEventId: recoveryEvent.id,
            razorpayOrderId: order.razorpayOrderId,
            amountPaise: order.amountPaise,
          },
        },
      });

      // Mark the order tracking row as processed so we don't re-detect it.
      // We set status to FAILED (a terminal state) since "abandoned" is
      // a terminal outcome for the order.
      await tx.orderTracking.update({
        where: { id: order.id },
        data: { status: OrderTrackingStatus.FAILED },
      });

      await emitCaseTransition(tx, {
        caseId: caseRecord.id,
        fromState: null,
        toState: CaseState.DETECTED,
        causeCode: null,
      });
    });

    createdCount++;
  }

  return {
    checkedCount: abandonedOrders.length,
    createdCount,
    skippedCount,
  };
}
