/**
 * Tests for the Razorpay API client — fallback behavior when keys are
 * missing, and the two live-demo helpers (`createOrder`, `fetchPayment`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable env mock — a couple of tests need real-looking keys to exercise
// the "keys present" path. Reset in `beforeEach`.
const mockEnv = {
  RAZORPAY_KEY_ID: "",
  RAZORPAY_KEY_SECRET: "",
  RECOVERY_CALLBACK_URL: "http://localhost:3000/api/webhooks/razorpay",
};

vi.mock("@/lib/env", () => ({ env: mockEnv }));

function configureRazorpay(keyId = "rzp_test_key", secret = "rzp_test_secret") {
  mockEnv.RAZORPAY_KEY_ID = keyId;
  mockEnv.RAZORPAY_KEY_SECRET = secret;
}

function unconfigureRazorpay() {
  mockEnv.RAZORPAY_KEY_ID = "";
  mockEnv.RAZORPAY_KEY_SECRET = "";
}

describe("Razorpay client — placeholder fallback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    unconfigureRazorpay();
  });

  it("returns a placeholder link when keys are not configured", async () => {
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
    if (!result.ok) return;
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

describe("Razorpay client — createOrder", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    unconfigureRazorpay();
  });

  it("returns a placeholder order when keys are not configured", async () => {
    const { createOrder } = await import("./client");
    const result = await createOrder({
      amountPaise: 49900,
      currency: "INR",
      receipt: "demo_abc",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isPlaceholder).toBe(true);
    expect(result.id).toBe("placeholder_order_demo_abc");
    expect(result.amountPaise).toBe(49900);
  });

  it("posts to /v1/orders and returns id + amount on success", async () => {
    configureRazorpay();
    const { createOrder } = await import("./client");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "order_LiveTest01", amount: 49900 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await createOrder({
      amountPaise: 49900,
      currency: "INR",
      receipt: "demo_xyz",
      notes: { demo: "true", scenario: "failed" },
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.razorpay.com/v1/orders",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.id).toBe("order_LiveTest01");
    expect(result.amountPaise).toBe(49900);
    expect(result.isPlaceholder).toBe(false);
  });

  it("surfaces an error envelope on API failure", async () => {
    configureRazorpay();
    const { createOrder } = await import("./client");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("bad request", { status: 400 }),
    );

    const result = await createOrder({ amountPaise: 100 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain("Razorpay API error 400");
  });
});

describe("Razorpay client — fetchPayment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    unconfigureRazorpay();
  });

  it("returns not-configured error when keys are absent", async () => {
    const { fetchPayment } = await import("./client");
    const result = await fetchPayment("pay_abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("not configured");
  });

  it("maps snake_case Razorpay fields to the typed subset on success", async () => {
    configureRazorpay();
    const { fetchPayment } = await import("./client");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "pay_LiveTest01",
          status: "failed",
          amount: 49900,
          currency: "INR",
          method: "card",
          email: "j@example.com",
          contact: "+919876543210",
          order_id: "order_LiveTest01",
          error_code: "BAD_REQUEST_ERROR",
          error_description: "Payment declined",
          error_source: "customer",
          error_step: "payment_authorization",
          error_reason: "payment_failed",
          created_at: 1700000000,
        }),
        { status: 200 },
      ),
    );

    const result = await fetchPayment("pay_LiveTest01");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("failed");
    expect(result.amountPaise).toBe(49900);
    expect(result.method).toBe("card");
    expect(result.errorCode).toBe("BAD_REQUEST_ERROR");
    expect(result.errorSource).toBe("customer");
    expect(result.orderId).toBe("order_LiveTest01");
  });

  it("surfaces an error envelope on API failure", async () => {
    configureRazorpay();
    const { fetchPayment } = await import("./client");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not found", { status: 404 }),
    );

    const result = await fetchPayment("pay_missing");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.statusCode).toBe(404);
  });
});
