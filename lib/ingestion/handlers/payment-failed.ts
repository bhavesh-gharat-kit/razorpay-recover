/**
 * Handler for `payment.failed` Razorpay webhook events.
 *
 * Creates a RecoveryEvent (CHECKOUT_DROPOFF scenario), a Case in DETECTED
 * state with an initial CaseTransition, and an AuditLog entry. Also upserts
 * an OrderTracking row so the abandonment detector knows this order had a
 * payment attempt (status FAILED).
 *
 * Does NOT do classification or any further processing — that's Phase 3+.
 */

import { prisma } from "@/lib/db";
import {
  Scenario,
  CaseState,
  Actor,
  OrderTrackingStatus,
} from "@prisma/client";
import type { HandlerResult } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function handlePaymentFailed(
  payload: Record<string, any>,
  eventId: string,
): Promise<HandlerResult> {
  const paymentEntity = payload?.payload?.payment?.entity;
  if (!paymentEntity) {
    return { action: "skipped_no_payment_entity" };
  }

  const orderId: string | undefined = paymentEntity.order_id;
  const amountPaise: number = paymentEntity.amount ?? 0;
  const currency: string = paymentEntity.currency ?? "INR";
  const customerEmail: string | undefined = paymentEntity.email;
  const customerPhone: string | undefined = paymentEntity.contact;
  const accountId: string | undefined =
    payload.account_id ?? paymentEntity.account_id;

  // Look up the merchant by Razorpay account ID.
  const merchant = accountId
    ? await prisma.merchant.findFirst({
        where: { razorpayAccountId: accountId },
      })
    : null;

  if (!merchant) {
    return { action: "skipped_unknown_merchant" };
  }

  // Find or create the customer by email within this merchant.
  let customer = customerEmail
    ? await prisma.customer.findUnique({
        where: {
          merchantId_email: {
            merchantId: merchant.id,
            email: customerEmail,
          },
        },
      })
    : null;

  if (!customer && customerEmail) {
    customer = await prisma.customer.create({
      data: {
        merchantId: merchant.id,
        name: customerEmail.split("@")[0], // Best-effort name from email
        email: customerEmail,
        phone: customerPhone ?? "",
      },
    });
  }

  if (!customer) {
    return { action: "skipped_no_customer_info" };
  }

  // Create RecoveryEvent, Case, CaseTransition, and AuditLog in a transaction.
  const result = await prisma.$transaction(async (tx) => {
    const recoveryEvent = await tx.recoveryEvent.create({
      data: {
        merchantId: merchant.id,
        customerId: customer!.id,
        scenario: Scenario.CHECKOUT_DROPOFF,
        sourceType: "razorpay_webhook",
        razorpayRefId: eventId,
        rawPayload: payload as any,
        amountPaise,
        currency,
        occurredAt: paymentEntity.created_at
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
        },
      },
    });

    return { recoveryEventId: recoveryEvent.id, caseId: caseRecord.id };
  });

  // Upsert OrderTracking — mark this order as FAILED so the abandonment
  // detector doesn't also flag it.
  if (orderId) {
    await prisma.orderTracking.upsert({
      where: { razorpayOrderId: orderId },
      create: {
        razorpayOrderId: orderId,
        merchantId: merchant.id,
        status: OrderTrackingStatus.FAILED,
        amountPaise,
        currency,
        customerEmail,
        customerPhone,
        rawPayload: payload as any,
      },
      update: {
        status: OrderTrackingStatus.FAILED,
        updatedAt: new Date(),
      },
    });
  }

  return {
    action: "recovery_event_created",
    entityId: result.caseId,
  };
}
