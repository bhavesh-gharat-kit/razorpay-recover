/**
 * Unit tests for the deterministic rule-based classifier.
 *
 * Tests every mapped error code pattern and verifies that an unmapped
 * case correctly falls through (returns null).
 */

import { describe, it, expect } from "vitest";
import { classifyByRules, classifyInvoiceOverdue, extractSignals } from "../rules";

// ---------------------------------------------------------------------------
// Helper — builds a minimal rawPayload matching the Razorpay webhook shape
// ---------------------------------------------------------------------------

function makePayload(overrides: {
  errorCode?: string;
  errorDescription?: string;
  method?: string;
  paymentId?: string | null;
}) {
  return {
    entity: "event",
    account_id: "acc_test",
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: overrides.paymentId === undefined ? "pay_test123" : overrides.paymentId,
          entity: "payment",
          amount: 100000,
          currency: "INR",
          status: "failed",
          order_id: "order_test123",
          method: overrides.method ?? "card",
          error_code: overrides.errorCode ?? "",
          error_description: overrides.errorDescription ?? "",
          error_source: "bank",
          error_step: "payment_authorization",
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classifyByRules", () => {
  describe("INSUFFICIENT_FUNDS", () => {
    it("matches BAD_REQUEST_ERROR with 'insufficient' in description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "Your payment could not be completed due to insufficient funds.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("INSUFFICIENT_FUNDS");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("matches BAD_REQUEST_ERROR with 'declined by the bank' in description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "Your payment didn't go through as it was declined by the bank. Try another payment method.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("INSUFFICIENT_FUNDS");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe("CARD_EXPIRED", () => {
    it("matches BAD_REQUEST_ERROR with 'expired' in description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "The card is expired. Please try with another card.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("CARD_EXPIRED");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("matches BAD_REQUEST_ERROR with 'invalid card' in description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "Transaction declined: invalid card number or details.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("CARD_EXPIRED");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe("GATEWAY_TIMEOUT", () => {
    it("matches GATEWAY_ERROR regardless of description", () => {
      const payload = makePayload({
        errorCode: "GATEWAY_ERROR",
        errorDescription: "Some random gateway issue.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("GATEWAY_TIMEOUT");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("matches SERVER_ERROR regardless of description", () => {
      const payload = makePayload({
        errorCode: "SERVER_ERROR",
        errorDescription:
          "We encountered an unexpected issue processing your payment.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("GATEWAY_TIMEOUT");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });
  });

  describe("OTP_ABANDONED", () => {
    it("matches BAD_REQUEST_ERROR with 'otp' in description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription: "User failed to enter OTP within the time limit.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("OTP_ABANDONED");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("matches BAD_REQUEST_ERROR with 'cancelled by the user' in description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "Payment was cancelled by the user after redirect to bank OTP page.",
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("OTP_ABANDONED");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it("matches UPI method with no payment_id", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription: "Some error that does not match other rules.",
        method: "upi",
        paymentId: null,
      });
      const result = classifyByRules(payload);
      expect(result).not.toBeNull();
      expect(result!.causeCode).toBe("OTP_ABANDONED");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("fall-through (no match)", () => {
    it("returns null for an unrecognized error code + description", () => {
      const payload = makePayload({
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription:
          "Transaction declined due to risk check failure on issuer side.",
      });
      const result = classifyByRules(payload);
      expect(result).toBeNull();
    });

    it("returns null for empty/missing payload", () => {
      expect(classifyByRules(null)).toBeNull();
      expect(classifyByRules(undefined)).toBeNull();
      expect(classifyByRules({})).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Subscription Failure (Phase 9)
// ---------------------------------------------------------------------------

function makeSubscriptionPayload(overrides: {
  event: "subscription.charged.failed" | "subscription.halted";
  errorCode?: string;
  errorDescription?: string;
}) {
  const subscriptionEntity = {
    id: "sub_test123",
    entity: "subscription",
    plan_id: "plan_test123",
    customer_id: "cust_test123",
    status: overrides.event === "subscription.halted" ? "halted" : "active",
  };

  if (overrides.event === "subscription.halted") {
    return {
      entity: "event",
      account_id: "acc_test",
      event: "subscription.halted",
      payload: { subscription: { entity: subscriptionEntity } },
    };
  }

  return {
    entity: "event",
    account_id: "acc_test",
    event: "subscription.charged.failed",
    payload: {
      payment: {
        entity: {
          id: "pay_test123",
          entity: "payment",
          amount: 99900,
          currency: "INR",
          status: "failed",
          method: "card",
          error_code: overrides.errorCode ?? "",
          error_description: overrides.errorDescription ?? "",
        },
      },
      subscription: { entity: subscriptionEntity },
    },
  };
}

describe("classifyByRules — Subscription Failure cause codes", () => {
  it("maps subscription.charged.failed with 'insufficient' to MANDATE_INSUFFICIENT_FUNDS", () => {
    const payload = makeSubscriptionPayload({
      event: "subscription.charged.failed",
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "The recurring charge failed due to insufficient funds.",
    });
    const result = classifyByRules(payload);
    expect(result).not.toBeNull();
    expect(result!.causeCode).toBe("MANDATE_INSUFFICIENT_FUNDS");
  });

  it("maps subscription.charged.failed with 'card' + 'expired' to MANDATE_EXPIRED_CARD", () => {
    const payload = makeSubscriptionPayload({
      event: "subscription.charged.failed",
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "The card linked to this subscription has expired.",
    });
    const result = classifyByRules(payload);
    expect(result).not.toBeNull();
    expect(result!.causeCode).toBe("MANDATE_EXPIRED_CARD");
  });

  it("maps subscription.charged.failed with 'mandate' wording to MANDATE_LAPSED, never a retry cause", () => {
    const payload = makeSubscriptionPayload({
      event: "subscription.charged.failed",
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "The mandate for this subscription has expired and needs to be re-authorized.",
    });
    const result = classifyByRules(payload);
    expect(result).not.toBeNull();
    expect(result!.causeCode).toBe("MANDATE_LAPSED");
  });

  it("maps subscription.halted to MANDATE_LAPSED even with no payment entity", () => {
    const payload = makeSubscriptionPayload({ event: "subscription.halted" });
    const result = classifyByRules(payload);
    expect(result).not.toBeNull();
    expect(result!.causeCode).toBe("MANDATE_LAPSED");
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("does NOT read a checkout payment.failed 'insufficient' description as a mandate cause", () => {
    // Same wording, but event is plain payment.failed — must stay scoped
    // to CHECKOUT_DROPOFF's INSUFFICIENT_FUNDS, not bleed into Phase 9's
    // subscription cause codes.
    const payload = makePayload({
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "Your payment could not be completed due to insufficient funds.",
    });
    const result = classifyByRules(payload);
    expect(result!.causeCode).toBe("INSUFFICIENT_FUNDS");
  });
});

// ---------------------------------------------------------------------------
// B2B Invoice Overdue (Phase 9) — rules-only, no free text
// ---------------------------------------------------------------------------

describe("classifyInvoiceOverdue", () => {
  it("classifies as INVOICE_OVERDUE when dueDate is in the past", () => {
    const dueDate = new Date("2026-08-01T00:00:00Z");
    const now = new Date("2026-08-10T00:00:00Z");
    const result = classifyInvoiceOverdue(dueDate, now);
    expect(result.causeCode).toBe("INVOICE_OVERDUE");
    expect(result.confidence).toBe(1.0);
  });

  it("does not classify as overdue when dueDate is in the future", () => {
    const dueDate = new Date("2026-09-01T00:00:00Z");
    const now = new Date("2026-08-10T00:00:00Z");
    const result = classifyInvoiceOverdue(dueDate, now);
    expect(result.causeCode).toBe("UNCLASSIFIED");
  });

  it("does not classify as overdue when dueDate is null", () => {
    const result = classifyInvoiceOverdue(null);
    expect(result.causeCode).toBe("UNCLASSIFIED");
  });
});

describe("extractSignals", () => {
  it("extracts fields from a well-formed payload", () => {
    const payload = makePayload({
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "test description",
      method: "card",
      paymentId: "pay_abc",
    });
    const signals = extractSignals(payload);
    expect(signals).toEqual({
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "test description",
      method: "card",
      paymentId: "pay_abc",
    });
  });

  it("returns null for a missing payment entity", () => {
    expect(extractSignals({ payload: {} })).toBeNull();
  });
});
