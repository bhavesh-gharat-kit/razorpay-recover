/**
 * Handler for `order.paid` Razorpay webhook events.
 *
 * Updates the OrderTracking record to PAID so the abandonment detector
 * knows this order completed successfully. If no OrderTracking row exists
 * yet, creates one.
 *
 * This handler does NOT create RecoveryEvents or Cases — it's purely for
 * the abandonment detection system's bookkeeping.
 */

import { prisma } from "@/lib/db";
import { OrderTrackingStatus } from "@prisma/client";
import type { HandlerResult } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
export async function handleOrderPaid(
  payload: Record<string, any>,
  _eventId: string,
): Promise<HandlerResult> {
  const orderEntity = payload?.payload?.order?.entity;
  if (!orderEntity) {
    return { action: "skipped_no_order_entity" };
  }

  const orderId: string | undefined = orderEntity.id;
  if (!orderId) {
    return { action: "skipped_no_order_id" };
  }

  const accountId: string | undefined = payload.account_id;
  const amountPaise: number = orderEntity.amount ?? 0;
  const currency: string = orderEntity.currency ?? "INR";

  // Look up the merchant.
  const merchant = accountId
    ? await prisma.merchant.findFirst({
        where: { razorpayAccountId: accountId },
      })
    : null;

  if (!merchant) {
    return { action: "skipped_unknown_merchant" };
  }

  // Upsert: if we already have a CREATED or FAILED tracking row for this
  // order, mark it PAID. If not, create a new PAID row.
  await prisma.orderTracking.upsert({
    where: { razorpayOrderId: orderId },
    create: {
      razorpayOrderId: orderId,
      merchantId: merchant.id,
      status: OrderTrackingStatus.PAID,
      amountPaise,
      currency,
      rawPayload: payload as any,
    },
    update: {
      status: OrderTrackingStatus.PAID,
      updatedAt: new Date(),
    },
  });

  return { action: "order_tracked_as_paid" };
}
