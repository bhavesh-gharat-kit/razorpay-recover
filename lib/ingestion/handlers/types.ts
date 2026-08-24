/**
 * Shared types for Razorpay webhook event handlers.
 *
 * Each handler is a function that receives the parsed webhook payload and
 * returns a result describing what it did. The dispatcher maps Razorpay
 * event types to handlers via a simple Record — adding a new event type
 * in Phase 9 is a one-file-per-handler change.
 */

export interface HandlerResult {
  /** What the handler did — for logging and the response body. */
  action: string;
  /** The entity ID created or affected, if any. */
  entityId?: string;
}

/**
 * A webhook event handler function.
 *
 * @param payload  - The full parsed Razorpay webhook payload.
 * @param eventId  - The top-level Razorpay event ID (used as idempotency key).
 */
export type EventHandler = (
  payload: Record<string, unknown>,
  eventId: string,
) => Promise<HandlerResult>;
