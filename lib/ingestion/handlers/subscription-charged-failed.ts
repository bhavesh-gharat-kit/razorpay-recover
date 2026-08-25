/**
 * Handler for `subscription.charged.failed` Razorpay webhook events
 * (Phase 9 — Subscription Failure scenario).
 *
 * Structurally mirrors `payment-failed.ts`: creates a RecoveryEvent
 * (`scenario: SUBSCRIPTION_FAILURE`), a Case in DETECTED, an initial
 * CaseTransition, and an AuditLog entry. Classification (Phase 3's rule
 * table, extended in Phase 9) reads the same `payload.payment.entity`
 * error fields this handler stores verbatim in `rawPayload` — this
 * handler does no classification itself.
 *
 * The subscription ID (`payload.subscription.entity.id`) is stored inside
 * `rawPayload` rather than a dedicated column — `subscription-resolved.ts`
 * looks Cases up by a JSON-path match on it when the mandate is later
 * fixed (`subscription.activated` / `subscription.completed`).
 */

import { prisma } from "@/lib/db";
import { Scenario, CaseState, Actor } from "@prisma/client";
import type { HandlerResult } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handleSubscriptionChargedFailed(
  payload: Record<string, any>,
  eventId: string,
): Promise<HandlerResult> {
  const subscriptionEntity = payload?.payload?.subscription?.entity;
  const paymentEntity = payload?.payload?.payment?.entity;

  if (!subscriptionEntity) {
    return { action: "skipped_no_subscription_entity" };
  }

  const amountPaise: number = paymentEntity?.amount ?? 0;
  const currency: string = paymentEntity?.currency ?? "INR";
  const customerEmail: string | undefined = paymentEntity?.email;
  const customerPhone: string | undefined = paymentEntity?.contact;
  const accountId: string | undefined =
    payload.account_id ?? paymentEntity?.account_id;

  const merchant = accountId
    ? await prisma.merchant.findFirst({ where: { razorpayAccountId: accountId } })
    : null;
  if (!merchant) {
    return { action: "skipped_unknown_merchant" };
  }

  let customer = customerEmail
    ? await prisma.customer.findUnique({
        where: { merchantId_email: { merchantId: merchant.id, email: customerEmail } },
      })
    : null;

  if (!customer && customerEmail) {
    customer = await prisma.customer.create({
      data: {
        merchantId: merchant.id,
        name: customerEmail.split("@")[0],
        email: customerEmail,
        phone: customerPhone ?? "",
      },
    });
  }

  if (!customer) {
    return { action: "skipped_no_customer_info" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const recoveryEvent = await tx.recoveryEvent.create({
      data: {
        merchantId: merchant.id,
        customerId: customer!.id,
        scenario: Scenario.SUBSCRIPTION_FAILURE,
        sourceType: "razorpay_webhook",
        razorpayRefId: eventId,
        rawPayload: payload as any,
        amountPaise,
        currency,
        occurredAt: paymentEntity?.created_at
          ? new Date(paymentEntity.created_at * 1000)
          : new Date(),
      },
    });

    const caseRecord = await tx.case.create({
      data: {
        recoveryEventId: recoveryEvent.id,
        merchantId: merchant.id,
        customerId: customer!.id,
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
          subscriptionId: subscriptionEntity.id ?? null,
        },
      },
    });

    return { caseId: caseRecord.id };
  });

  return { action: "recovery_event_created", entityId: result.caseId };
}
