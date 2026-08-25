/**
 * Handler for `subscription.halted` Razorpay webhook events (Phase 9).
 *
 * Razorpay halts a subscription automatically once its mandate charge
 * retries are exhausted — the event alone is a reliable, high-confidence
 * MANDATE_LAPSED signal (see `classifyByRules` in `lib/classification/rules.ts`).
 * Otherwise this creates a RecoveryEvent + Case exactly like
 * `subscription-charged-failed.ts`.
 *
 * The `subscription.halted` payload carries only `subscription.entity` —
 * unlike `subscription.charged.failed` there's no `payment.entity` to read
 * an amount off. A production integration would resolve the amount via
 * the Razorpay Plan API (`subscription.entity.plan_id`); for this
 * buildathon we instead reuse the amount from the most recent
 * SUBSCRIPTION_FAILURE RecoveryEvent for the same subscription ID (there
 * is almost always one — Razorpay halts only after prior charge
 * failures), falling back to 0 (logged) if none exists.
 */

import { prisma } from "@/lib/db";
import { Scenario, CaseState, Actor } from "@prisma/client";
import type { HandlerResult } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleSubscriptionHalted(
  payload: Record<string, any>,
  eventId: string,
): Promise<HandlerResult> {
  const subscriptionEntity = payload?.payload?.subscription?.entity;
  if (!subscriptionEntity?.id) {
    return { action: "skipped_no_subscription_entity" };
  }

  const accountId: string | undefined = payload.account_id;
  const merchant = accountId
    ? await prisma.merchant.findFirst({ where: { razorpayAccountId: accountId } })
    : null;
  if (!merchant) {
    return { action: "skipped_unknown_merchant" };
  }

  // Reuse customer + amount from the most recent RecoveryEvent tied to
  // this subscription, if one exists (see file doc comment above).
  const priorEvent = await prisma.recoveryEvent.findFirst({
    where: {
      scenario: Scenario.SUBSCRIPTION_FAILURE,
      merchantId: merchant.id,
      rawPayload: {
        path: "$.payload.subscription.entity.id",
        equals: subscriptionEntity.id,
      },
    },
    orderBy: { createdAt: "desc" },
    include: { customer: true },
  });

  const customerEmail: string | undefined = priorEvent?.customer?.email;
  const customer = priorEvent?.customer ?? null;

  if (!customer) {
    // No customer trail for this subscription and no contact info on this
    // payload either — nothing to notify, so skip rather than guess.
    return { action: "skipped_no_customer_info" };
  }

  const amountPaise = priorEvent?.amountPaise ?? 0;
  if (!priorEvent) {
    console.warn(
      `[ingestion] subscription.halted for ${subscriptionEntity.id} had no prior ` +
        "SUBSCRIPTION_FAILURE RecoveryEvent to source an amount from — using 0.",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const recoveryEvent = await tx.recoveryEvent.create({
      data: {
        merchantId: merchant.id,
        customerId: customer.id,
        scenario: Scenario.SUBSCRIPTION_FAILURE,
        sourceType: "razorpay_webhook",
        razorpayRefId: eventId,
        rawPayload: payload as any,
        amountPaise,
        currency: priorEvent?.currency ?? "INR",
        occurredAt: new Date(),
      },
    });

    const caseRecord = await tx.case.create({
      data: {
        recoveryEventId: recoveryEvent.id,
        merchantId: merchant.id,
        customerId: customer.id,
        state: CaseState.DETECTED,
        attemptCount: 0,
        maxAttempts: 3,
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: null,
        toState: CaseState.DETECTED,
        actor: Actor.SYSTEM,
        reasonCode: "event_ingested",
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseRecord.id,
        actor: Actor.SYSTEM,
        action: "event_ingested",
        reasonCode: "event_ingested",
        afterState: {
          caseId: caseRecord.id,
          state: CaseState.DETECTED,
          recoveryEventId: recoveryEvent.id,
          amountPaise,
          subscriptionId: subscriptionEntity.id,
          customerEmail: customerEmail ?? null,
        },
      },
    });

    return { caseId: caseRecord.id };
  });

  return { action: "recovery_event_created", entityId: result.caseId };
}
