/**
 * Event-type dispatcher for Razorpay webhook events.
 *
 * Maps Razorpay event type strings to handler functions. Adding a new
 * event type in Phase 9 is a one-file-per-handler change: write the
 * handler, import it here, and add it to the map.
 */

import type { EventHandler } from "./types";
import { handlePaymentFailed } from "./payment-failed";
import { handlePaymentLinkPaid } from "./payment-link-paid";
import { handlePaymentCaptured } from "./payment-captured";
import { handleOrderPaid } from "./order-paid";

/**
 * Map of Razorpay event type → handler function.
 *
 * Unrecognized event types are silently ignored (return 200 to Razorpay
 * so it doesn't retry). To add a new handler, import it and add an entry.
 */
export const eventHandlers: Record<string, EventHandler> = {
  "payment.failed": handlePaymentFailed,
  "payment_link.paid": handlePaymentLinkPaid,
  "payment.captured": handlePaymentCaptured,
  "order.paid": handleOrderPaid,
};

export type { EventHandler, HandlerResult } from "./types";
