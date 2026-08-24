/**
 * Tests for the Razorpay API client — specifically the fallback behavior
 * when keys are not configured.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock env BEFORE importing the module.
vi.mock("@/lib/env", () => ({
  env: {
    RAZORPAY_KEY_ID: "",
    RAZORPAY_KEY_SECRET: "",
    RECOVERY_CALLBACK_URL: "http://localhost:3000/api/webhooks/razorpay",
  },
}));

describe("Razorpay client — placeholder fallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a placeholder link when keys are not configured", async () => {
    // Dynamic import so the mock is in place.
    const { createPaymentLink } = await import("./client");

    const result = await createPaymentLink({
      amountPaise: 100000,
      currency: "INR",
      description: "Test recovery",
      customerName: "Test User",
      customerEmail: "test@example.com",
      customerPhone: "+919876543210",
      expireBy: Math.floor(Date.now() / 1000) + 72 * 3600,
      referenceId: "case_123",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrowing

    expect(result.isPlaceholder).toBe(true);
    expect(result.id).toBe("placeholder_plink_case_123");
    expect(result.shortUrl).toBe("https://example.com/pay/case_123");
  });

  it("returns an error for fetchPaymentLinkStatus when keys are not configured", async () => {
    const { fetchPaymentLinkStatus } = await import("./client");

    const result = await fetchPaymentLinkStatus("plink_12345");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not configured");
  });
});
