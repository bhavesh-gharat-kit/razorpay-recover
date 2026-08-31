/**
 * Route-level tests for /api/demo/**. Uses mocked Prisma + Razorpay
 * client + pipeline so the route logic (validation, idempotency, the
 * demo-source guard) is tested in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { _resetAllRateLimitsForTests } from "@/lib/auth/rateLimit";

// --- Mutable env mock ------------------------------------------------
const mockEnv = {
  RAZORPAY_KEY_ID: "rzp_test_key",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_ACCOUNT_ID: "acc_TestDemo001",
  RECOVERY_CALLBACK_URL: "http://localhost:3000/api/webhooks/razorpay",
  MAX_CONTACTS_PER_CUSTOMER_PER_DAY: 2,
  HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE: 500000,
  CHECKOUT_ABANDONMENT_GRACE_MINUTES: 30,
  USE_LLM_DRAFTING: false,
};

vi.mock("@/lib/env", () => ({ env: mockEnv }));

// --- Prisma mock -----------------------------------------------------
const mockPrisma = {
  merchant: {
    findFirst: vi.fn(),
  },
  orderTracking: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  recoveryEvent: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  case: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

// --- Razorpay client mocks -------------------------------------------
const mockCreateOrder = vi.fn();
const mockFetchPayment = vi.fn();
vi.mock("@/lib/razorpay/client", () => ({
  createOrder: mockCreateOrder,
  fetchPayment: mockFetchPayment,
}));

// --- Ingestion + pipeline mocks --------------------------------------
const mockHandlePaymentFailed = vi.fn();
vi.mock("@/lib/ingestion/handlers/payment-failed", () => ({
  handlePaymentFailed: mockHandlePaymentFailed,
}));

const mockDetectAbandonment = vi.fn();
vi.mock("@/lib/ingestion/detect-abandonment", () => ({
  detectAbandonedCheckouts: mockDetectAbandonment,
}));

const mockRunDemoPipeline = vi.fn();
vi.mock("@/lib/demo/pipeline", () => ({
  runDemoPipeline: mockRunDemoPipeline,
}));

// --- Timeline mock — the read endpoint calls it ----------------------
const mockBuildTimeline = vi.fn();
vi.mock("@/lib/audit/timeline", () => ({
  buildCaseTimeline: mockBuildTimeline,
}));

// ---------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  const req = new NextRequest("http://localhost/api/demo", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return req;
}

function resetEnv() {
  mockEnv.RAZORPAY_KEY_ID = "rzp_test_key";
  mockEnv.RAZORPAY_KEY_SECRET = "rzp_test_secret";
  mockEnv.RAZORPAY_ACCOUNT_ID = "acc_TestDemo001";
}

describe("POST /api/demo/order — validation + config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAllRateLimitsForTests();
    resetEnv();
    mockPrisma.merchant.findFirst.mockResolvedValue({
      id: "m1",
      razorpayAccountId: "acc_TestDemo001",
    });
  });

  it("returns 503 when Razorpay keys are missing", async () => {
    mockEnv.RAZORPAY_KEY_ID = "";
    const { POST } = await import("../order/route");
    const res = await POST(
      makeRequest({ email: "a@b.co", amountPaise: 49900, scenario: "failed" }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("RAZORPAY_NOT_CONFIGURED");
  });

  it("returns 400 for a malformed email", async () => {
    const { POST } = await import("../order/route");
    const res = await POST(
      makeRequest({ email: "not-an-email", amountPaise: 49900, scenario: "failed" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_EMAIL");
  });

  it("returns 400 when amount is out of range (too small)", async () => {
    const { POST } = await import("../order/route");
    const res = await POST(
      makeRequest({ email: "a@b.co", amountPaise: 50, scenario: "failed" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 when amount is out of range (too large)", async () => {
    const { POST } = await import("../order/route");
    const res = await POST(
      makeRequest({ email: "a@b.co", amountPaise: 5_000_000, scenario: "failed" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_AMOUNT");
  });

  it("returns 400 for an invalid scenario", async () => {
    const { POST } = await import("../order/route");
    const res = await POST(
      makeRequest({ email: "a@b.co", amountPaise: 49900, scenario: "banana" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SCENARIO");
  });

  it("creates an order and returns orderId + keyId on the happy path", async () => {
    mockCreateOrder.mockResolvedValueOnce({
      ok: true,
      id: "order_LiveTest01",
      amountPaise: 49900,
      isPlaceholder: false,
    });
    mockPrisma.orderTracking.upsert.mockResolvedValueOnce({});

    const { POST } = await import("../order/route");
    const res = await POST(
      makeRequest({
        email: "j@example.com",
        name: "Judge",
        amountPaise: 49900,
        scenario: "failed",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.orderId).toBe("order_LiveTest01");
    expect(body.data.keyId).toBe("rzp_test_key");
    expect(body.data.prefill).toEqual({ email: "j@example.com", name: "Judge" });
    expect(mockPrisma.orderTracking.upsert).toHaveBeenCalled();
  });
});

describe("POST /api/demo/result — failed scenario + idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAllRateLimitsForTests();
    resetEnv();
    mockPrisma.merchant.findFirst.mockResolvedValue({
      id: "m1",
      razorpayAccountId: "acc_TestDemo001",
    });
  });

  it("returns 404 when the order isn't a demo order", async () => {
    mockPrisma.orderTracking.findUnique.mockResolvedValueOnce({
      razorpayOrderId: "order_x",
      rawPayload: { demo: false },
      merchantId: "m1",
      amountPaise: 49900,
      currency: "INR",
      customerEmail: null,
      customerPhone: null,
    });
    const { POST } = await import("../result/route");
    const res = await POST(
      makeRequest({
        orderId: "order_x",
        paymentId: "pay_x",
        outcome: "failed",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("failed outcome: ingests via handlePaymentFailed and runs the demo pipeline", async () => {
    mockPrisma.orderTracking.findUnique.mockResolvedValueOnce({
      razorpayOrderId: "order_1",
      rawPayload: { demo: true },
      merchantId: "m1",
      amountPaise: 49900,
      currency: "INR",
      customerEmail: "j@example.com",
      customerPhone: "",
    });
    mockPrisma.recoveryEvent.findUnique.mockResolvedValueOnce(null); // not deduped
    mockFetchPayment.mockResolvedValueOnce({
      ok: true,
      id: "pay_1",
      status: "failed",
      amountPaise: 49900,
      currency: "INR",
      method: "card",
      email: "j@example.com",
      contact: "+919876543210",
      orderId: "order_1",
      errorCode: "BAD_REQUEST_ERROR",
      errorDescription: "Declined",
      errorSource: "customer",
      errorStep: "payment_authorization",
      errorReason: "payment_failed",
      createdAt: 1700000000,
    });
    mockHandlePaymentFailed.mockResolvedValueOnce({
      action: "recovery_event_created",
      entityId: "case_new",
    });
    mockPrisma.recoveryEvent.updateMany.mockResolvedValueOnce({ count: 1 });
    mockRunDemoPipeline.mockResolvedValueOnce({
      caseId: "case_new",
      finalState: "ACTION_SENT",
      steps: ["classified", "executed"],
    });

    const { POST } = await import("../result/route");
    const res = await POST(
      makeRequest({
        orderId: "order_1",
        paymentId: "pay_1",
        outcome: "failed",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.caseId).toBe("case_new");
    expect(body.data.state).toBe("ACTION_SENT");
    expect(mockHandlePaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "payment.failed",
        account_id: "acc_TestDemo001",
      }),
      "pay_1",
    );
    // sourceType was updated to the demo marker.
    expect(mockPrisma.recoveryEvent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceType: "demo_checkout" }),
      }),
    );
    expect(mockRunDemoPipeline).toHaveBeenCalledWith("case_new");
  });

  it("failed outcome: hands back the existing case when the webhook beat us", async () => {
    mockPrisma.orderTracking.findUnique.mockResolvedValueOnce({
      razorpayOrderId: "order_1",
      rawPayload: { demo: true },
      merchantId: "m1",
      amountPaise: 49900,
      currency: "INR",
      customerEmail: "j@example.com",
      customerPhone: "",
    });
    mockPrisma.recoveryEvent.findUnique.mockResolvedValueOnce({
      id: "re_existing",
      case: { id: "case_existing", state: "ACTION_SENT" },
    });

    const { POST } = await import("../result/route");
    const res = await POST(
      makeRequest({
        orderId: "order_1",
        paymentId: "pay_1",
        outcome: "failed",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.caseId).toBe("case_existing");
    expect(body.data.deduped).toBe(true);
    // Should NOT have called the ingestion handler when deduping.
    expect(mockHandlePaymentFailed).not.toHaveBeenCalled();
    expect(mockRunDemoPipeline).not.toHaveBeenCalled();
  });

  it("dismissed outcome: marks order FAILED and returns null caseId", async () => {
    mockPrisma.orderTracking.findUnique.mockResolvedValueOnce({
      razorpayOrderId: "order_1",
      rawPayload: { demo: true },
      merchantId: "m1",
      amountPaise: 49900,
      currency: "INR",
      customerEmail: null,
      customerPhone: null,
    });
    mockPrisma.orderTracking.update.mockResolvedValueOnce({});

    const { POST } = await import("../result/route");
    const res = await POST(
      makeRequest({ orderId: "order_1", outcome: "dismissed" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.caseId).toBeNull();
    expect(mockPrisma.orderTracking.update).toHaveBeenCalledWith({
      where: { razorpayOrderId: "order_1" },
      data: { status: "FAILED" },
    });
  });
});

describe("GET /api/demo/case/[id] — demo-source guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAllRateLimitsForTests();
    resetEnv();
  });

  it("404s a case whose RecoveryEvent.sourceType is not a demo marker", async () => {
    mockPrisma.case.findUnique.mockResolvedValueOnce({
      id: "case_real",
      state: "DIAGNOSED",
      createdAt: new Date(),
      recoveryLinkUrl: null,
      customer: { email: "real@example.com" },
      classifiedCase: null,
      recoveryEvent: {
        amountPaise: 100000,
        currency: "INR",
        scenario: "CHECKOUT_DROPOFF",
        sourceType: "razorpay_webhook",
      },
    });

    const { GET } = await import("../case/[id]/route");
    const req = new NextRequest("http://localhost/api/demo/case/case_real");
    const res = await GET(req, { params: { id: "case_real" } });
    expect(res.status).toBe(404);
  });

  it("returns a masked email + timeline for a demo case", async () => {
    mockPrisma.case.findUnique.mockResolvedValueOnce({
      id: "case_demo",
      state: "ACTION_SENT",
      createdAt: new Date(),
      recoveryLinkUrl: "https://rzp.io/l/x",
      customer: { email: "judge@example.com" },
      classifiedCase: {
        causeCode: "INSUFFICIENT_FUNDS",
        confidence: 0.92,
        source: "RULE",
      },
      recoveryEvent: {
        amountPaise: 49900,
        currency: "INR",
        scenario: "CHECKOUT_DROPOFF",
        sourceType: "demo_checkout",
      },
    });
    mockBuildTimeline.mockResolvedValueOnce([
      { source: "AuditLog", description: "event_ingested" },
    ]);

    const { GET } = await import("../case/[id]/route");
    const req = new NextRequest("http://localhost/api/demo/case/case_demo");
    const res = await GET(req, { params: { id: "case_demo" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.caseId).toBe("case_demo");
    expect(body.data.customerEmailMasked).toBe("j••@example.com");
    expect(body.data.recoveryLinkUrl).toBe("https://rzp.io/l/x");
    expect(body.data.timeline).toHaveLength(1);
  });
});
