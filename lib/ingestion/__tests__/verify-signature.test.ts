/**
 * Unit tests for Razorpay webhook signature verification.
 */

import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyRazorpaySignature } from "../verify-signature";

const TEST_SECRET = "whsec_test_secret_for_unit_tests";

function makeSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyRazorpaySignature", () => {
  it("returns true for a valid signature", () => {
    const body = JSON.stringify({ event: "payment.failed", id: "evt_123" });
    const sig = makeSignature(body, TEST_SECRET);

    expect(verifyRazorpaySignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it("returns false for a mismatched signature", () => {
    const body = JSON.stringify({ event: "payment.failed", id: "evt_123" });
    const sig = makeSignature(body, "wrong_secret");

    expect(verifyRazorpaySignature(body, sig, TEST_SECRET)).toBe(false);
  });

  it("returns false when the body has been tampered with", () => {
    const body = JSON.stringify({ event: "payment.failed", id: "evt_123" });
    const sig = makeSignature(body, TEST_SECRET);
    const tampered = JSON.stringify({
      event: "payment.failed",
      id: "evt_tampered",
    });

    expect(verifyRazorpaySignature(tampered, sig, TEST_SECRET)).toBe(false);
  });

  it("returns false for an empty signature", () => {
    const body = JSON.stringify({ event: "payment.failed" });
    expect(verifyRazorpaySignature(body, "", TEST_SECRET)).toBe(false);
  });

  it("returns false for an empty secret", () => {
    const body = JSON.stringify({ event: "payment.failed" });
    const sig = makeSignature(body, TEST_SECRET);
    expect(verifyRazorpaySignature(body, sig, "")).toBe(false);
  });

  it("returns false for an empty body", () => {
    const sig = makeSignature("something", TEST_SECRET);
    expect(verifyRazorpaySignature("", sig, TEST_SECRET)).toBe(false);
  });

  it("returns false for a non-hex signature string", () => {
    const body = JSON.stringify({ event: "payment.failed" });
    // "not_hex" will fail Buffer.from(..., 'hex') gracefully — length mismatch
    expect(verifyRazorpaySignature(body, "not_hex_at_all!", TEST_SECRET)).toBe(
      false,
    );
  });

  it("handles JSON with special characters", () => {
    const body = JSON.stringify({
      event: "payment.failed",
      data: { message: 'Test with "quotes" and \\backslash' },
    });
    const sig = makeSignature(body, TEST_SECRET);

    expect(verifyRazorpaySignature(body, sig, TEST_SECRET)).toBe(true);
  });

  it("is sensitive to whitespace differences in the body", () => {
    const compact = '{"event":"payment.failed"}';
    const pretty = '{ "event": "payment.failed" }';
    const sig = makeSignature(compact, TEST_SECRET);

    // The signature was computed over the compact form — verifying
    // with the pretty-printed form must fail.
    expect(verifyRazorpaySignature(pretty, sig, TEST_SECRET)).toBe(false);
  });
});
