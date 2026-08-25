/**
 * Handler for `subscription.activated` and `subscription.completed`
 * Razorpay webhook events (Phase 9) — the auto-recovery loop for the
 * Subscription Failure scenario, mirroring `payment-link-paid.ts`'s role
 * for Checkout Drop-off.
 *
 * `subscription.activated` fires once a customer re-authorizes a lapsed
 * mandate or the next recurring charge succeeds; `subscription.completed`
 * fires when the subscription runs its full course. Either means whatever
 * problem the case was tracking is resolved, so any matching non-terminal
 * Case for this subscription auto-recovers.
 *
 * Cases aren't linked to a subscription by a dedicated column (unlike
 * Payment Links, which get a `Case.recoveryLinkId`) — instead this looks
 * up the RecoveryEvent by a JSON-path match on
 * `rawPayload.payload.subscription.entity.id`, same as `subscription-halted.ts`.
 */

import { prisma } from "@/lib/db";
import { CaseState, Scenario, Actor } from "@prisma/client";
import type { HandlerResult } from "./types";
import { emitCaseTransition, emitRecoveryDetected } from "@/lib/events/emit";

const RECOVERABLE_STATES: CaseState[] = [
  CaseState.ACTION_SENT,
  CaseState.ACTION_SCHEDULED,
  CaseState.DIAGNOSED,
  CaseState.DETECTED,
];

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
export async function handleSubscriptionResolved(
  payload: Record<string, any>,
  _eventId: string,
): Promise<HandlerResult> {
  const subscriptionEntity = payload?.payload?.subscription?.entity;
  const subscriptionId: string | undefined = subscriptionEntity?.id;
  if (!subscriptionId) {
    return { action: "skipped_no_subscription_entity" };
  }

  const caseRecord = await prisma.case.findFirst({
    where: {
      state: { in: RECOVERABLE_STATES },
      recoveryEvent: {
        scenario: Scenario.SUBSCRIPTION_FAILURE,
        rawPayload: {
          path: "$.payload.subscription.entity.id",
          equals: subscriptionId,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    include: {
      classifiedCase: { select: { causeCode: true } },
      recoveryEvent: { select: { amountPaise: true } },
    },
  });

  if (!caseRecord) {
    return { action: "no_matching_case" };
  }

  const recoveredAmountPaise = caseRecord.recoveryEvent.amountPaise;

  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseRecord.id },
      data: { state: CaseState.RECOVERED, recoveredAmountPaise },
    });

    await tx.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: caseRecord.state,
        toState: CaseState.RECOVERED,
        actor: Actor.SYSTEM,
        reasonCode: "subscription_resolved_auto_recovered",
        metadata: { subscriptionId, event: payload.event ?? null, recoveredAmountPaise },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseRecord.id,
        actor: Actor.SYSTEM,
        action: "auto_recovered",
        reasonCode: "subscription_resolved_auto_recovered",
        beforeState: { state: caseRecord.state },
        afterState: { state: CaseState.RECOVERED, recoveredAmountPaise },
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

  return { action: "case_auto_recovered", entityId: caseRecord.id };
}
