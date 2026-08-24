/**
 * Unit tests for the deterministic rule-based classifier.
 *
 * Tests every mapped error code pattern and verifies that an unmapped
 * case correctly falls through (returns null).
 */

import { describe, it, expect } from "vitest";
import { classifyByRules, extractSignals } from "../rules";

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
