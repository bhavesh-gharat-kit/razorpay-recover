/**
 * Handler for `payment_link.paid` Razorpay webhook events.
 *
 * This is the AUTO-RECOVERY LOOP: when a customer pays via a recovery
 * Payment Link we created, this handler detects it and transitions the
 * Case to RECOVERED — completing the money-recovery feedback loop.
 *
 * The handler looks up the Case by `recoveryLinkId` (the `plink_*` ID
 * stored on the Case when Phase 4 creates the Payment Link). If no
 * matching Case exists (e.g. the Payment Link wasn't created by us),
 * we silently ignore — never block Razorpay's webhook delivery.
 */

import { prisma } from "@/lib/db";
import { CaseState, Actor } from "@prisma/client";
import type { HandlerResult } from "./types";
import { emitCaseTransition, emitRecoveryDetected } from "@/lib/events/emit";

/** Case states where auto-recovery makes sense. */
const RECOVERABLE_STATES: CaseState[] = [
  CaseState.ACTION_SENT,
  CaseState.ACTION_SCHEDULED,
  CaseState.DIAGNOSED,
];

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
export async function handlePaymentLinkPaid(
  payload: Record<string, any>,
  _eventId: string,
): Promise<HandlerResult> {
  const paymentLinkEntity = payload?.payload?.payment_link?.entity;
  if (!paymentLinkEntity) {
    return { action: "skipped_no_payment_link_entity" };
  }

  const paymentLinkId: string | undefined = paymentLinkEntity.id;
  if (!paymentLinkId) {
    return { action: "skipped_no_payment_link_id" };
  }

  // Find the Case whose recoveryLinkId matches this Payment Link.
  const caseRecord = await prisma.case.findFirst({
    where: { recoveryLinkId: paymentLinkId },
    include: { classifiedCase: { select: { causeCode: true } } },
  });

  if (!caseRecord) {
    // Not a Payment Link we created — ignore silently.
    return { action: "no_matching_case" };
  }

  if (!RECOVERABLE_STATES.includes(caseRecord.state)) {
    return {
      action: "case_not_in_recoverable_state",
      entityId: caseRecord.id,
    };
  }

  // Extract the payment amount and Razorpay payment ID for traceability.
  const paymentEntity = payload?.payload?.payment?.entity;
  const recoveredAmountPaise: number =
    paymentEntity?.amount ?? paymentLinkEntity.amount ?? 0;
  const razorpayPaymentId: string | undefined = paymentEntity?.id;

  // Transition the case to RECOVERED in a transaction.
  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseRecord.id },
      data: {
        state: CaseState.RECOVERED,
        recoveredAmountPaise,
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: caseRecord.state,
        toState: CaseState.RECOVERED,
        actor: Actor.SYSTEM,
        reasonCode: "payment_link_paid_auto_recovered",
        metadata: {
          razorpayPaymentId: razorpayPaymentId ?? null,
          paymentLinkId,
          recoveredAmountPaise,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseRecord.id,
        actor: Actor.SYSTEM,
        action: "auto_recovered",
        reasonCode: "payment_link_paid_auto_recovered",
        beforeState: { state: caseRecord.state },
        afterState: {
          state: CaseState.RECOVERED,
          recoveredAmountPaise,
        },
      },
    });

    await emitCaseTransition(tx, {
      caseId: caseRecord.id,
      fromState: caseRecord.state,
      toState: CaseState.RECOVERED,
      causeCode: caseRecord.classifiedCase?.causeCode ?? null,
    });

    await emitRecoveryDetected(tx, {
      caseId: caseRecord.id,
      amountPaise: recoveredAmountPaise,
    });
  });

  return {
    action: "case_auto_recovered",
    entityId: caseRecord.id,
  };
}
