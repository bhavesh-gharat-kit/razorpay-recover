/**
 * Handler for `payment.captured` Razorpay webhook events.
 *
 * Handles the case where a customer retries payment through the merchant's
 * own checkout (not via our recovery link). We look for an open Case whose
 * RecoveryEvent's rawPayload references the same order_id. If found, we
 * auto-recover it to avoid sending a stale recovery email.
 *
 * If no matching Case exists, this is a normal successful payment
 * unrelated to recovery — we ignore it silently.
 */

import { prisma } from "@/lib/db";
import { CaseState, Actor } from "@prisma/client";
import type { HandlerResult } from "./types";

/** Case states where a captured-payment auto-close makes sense. */
const CLOSEABLE_STATES: CaseState[] = [
  CaseState.DETECTED,
  CaseState.DIAGNOSED,
  CaseState.ACTION_SCHEDULED,
  CaseState.ACTION_SENT,
];

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
export async function handlePaymentCaptured(
  payload: Record<string, any>,
  _eventId: string,
): Promise<HandlerResult> {
  const paymentEntity = payload?.payload?.payment?.entity;
  if (!paymentEntity) {
    return { action: "skipped_no_payment_entity" };
  }

  const orderId: string | undefined = paymentEntity.order_id;
  if (!orderId) {
    return { action: "skipped_no_order_id" };
  }

  const capturedAmount: number = paymentEntity.amount ?? 0;
  const razorpayPaymentId: string | undefined = paymentEntity.id;

  // Find an open Case whose RecoveryEvent references this order_id.
  // Prisma doesn't support JSON path queries on MySQL well, so we find
  // the RecoveryEvent first by searching the rawPayload for the order_id,
  // then check if it has an open Case.
  //
  // We look for RecoveryEvents whose rawPayload contains the order_id.
  // Since rawPayload is stored as JSON, we use a raw query for the JSON
  // path lookup.
  const matchingEvents = await prisma.$queryRaw<{ id: string }[]>`
    SELECT re.id
    FROM RecoveryEvent re
    WHERE JSON_UNQUOTE(JSON_EXTRACT(re.rawPayload, '$.payload.payment.entity.order_id')) = ${orderId}
    LIMIT 5
  `;

  if (matchingEvents.length === 0) {
    // Normal successful payment, not related to recovery.
    return { action: "no_matching_event" };
  }

  const eventIds = matchingEvents.map((e) => e.id);

  // Find an open Case linked to one of these events.
  const caseRecord = await prisma.case.findFirst({
    where: {
      recoveryEventId: { in: eventIds },
      state: { in: CLOSEABLE_STATES },
    },
  });

  if (!caseRecord) {
    return { action: "no_open_case_for_order" };
  }

  // Auto-recover the case.
  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseRecord.id },
      data: {
        state: CaseState.RECOVERED,
        recoveredAmountPaise: capturedAmount,
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: caseRecord.state,
        toState: CaseState.RECOVERED,
        actor: Actor.SYSTEM,
        reasonCode: "payment_captured_auto_recovered",
        metadata: {
          razorpayPaymentId: razorpayPaymentId ?? null,
          orderId,
          capturedAmount,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseRecord.id,
        actor: Actor.SYSTEM,
        action: "auto_recovered",
        reasonCode: "payment_captured_auto_recovered",
        beforeState: { state: caseRecord.state },
        afterState: {
          state: CaseState.RECOVERED,
          recoveredAmountPaise: capturedAmount,
        },
      },
    });
  });

  return {
    action: "case_auto_recovered_via_checkout",
    entityId: caseRecord.id,
  };
}
