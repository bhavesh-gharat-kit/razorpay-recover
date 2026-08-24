/**
 * Tests for the Recovery Orchestrator guardrail logic.
 *
 * Uses mocked Prisma + Razorpay client to test the decision logic in
 * isolation without touching the database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CaseState } from "@prisma/client";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Prisma — we return controlled data to test each guardrail.
const mockPrisma = {
  case: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  recoveryPolicy: {
    findFirst: vi.fn(),
  },
  caseTransition: {
    create: vi.fn(),
    count: vi.fn(),
  },
  scheduledJob: {
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn((fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
    fn(mockPrisma),
  ),
};

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/env", () => ({
  env: {
    MAX_CONTACTS_PER_CUSTOMER_PER_DAY: 2,
    RECOVERY_CALLBACK_URL: "http://localhost:3000/api/webhooks/razorpay",
    RAZORPAY_KEY_ID: "",
    RAZORPAY_KEY_SECRET: "",
  },
}));

vi.mock("@/lib/razorpay/client", () => ({
  createPaymentLink: vi.fn().mockResolvedValue({
    ok: true,
    id: "placeholder_plink_test",
    shortUrl: "https://example.com/pay/test",
    isPlaceholder: true,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case_test",
    state: CaseState.DIAGNOSED,
    attemptCount: 0,
    maxAttempts: 3,
    customerId: "cust_1",
    promisedPaymentDate: null,
    classifiedCase: { causeCode: "INSUFFICIENT_FUNDS" },
    recoveryEvent: {
      scenario: "CHECKOUT_DROPOFF",
      amountPaise: 100000,
      currency: "INR",
    },
    customer: {
      name: "Test",
      email: "test@example.com",
      phone: "+919876543210",
    },
    transitions: [],
    ...overrides,
  };
}

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy_1",
    scenario: "CHECKOUT_DROPOFF",
    causeCode: "INSUFFICIENT_FUNDS",
    allowedActions: ["RETRY_LINK"],
    cooldownMinutes: 60,
    maxAttempts: 3,
    active: true,
    sendWindowStartHour: 0, // 0–23 so tests always land inside window
    sendWindowEndHour: 23,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy-path mocks.
    mockPrisma.case.findUniqueOrThrow.mockResolvedValue(makeCase());
    mockPrisma.recoveryPolicy.findFirst.mockResolvedValue(makePolicy());
    mockPrisma.caseTransition.count.mockResolvedValue(0); // no recent contacts
  });

  it("escalates when no policy is found for the cause code", async () => {
    const { decideNextAction } = await import("./orchestrator");

    mockPrisma.recoveryPolicy.findFirst.mockResolvedValue(null);

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("escalated");
    expect(result.reason).toBe("no_policy_configured");
    // Should have called case.update to set ESCALATED
    expect(mockPrisma.case.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: CaseState.ESCALATED },
      }),
    );
  });

  it("escalates when max attempts are exhausted", async () => {
    const { decideNextAction } = await import("./orchestrator");

    mockPrisma.case.findUniqueOrThrow.mockResolvedValue(
      makeCase({ attemptCount: 3, maxAttempts: 3 }),
    );
    mockPrisma.recoveryPolicy.findFirst.mockResolvedValue(
      makePolicy({ maxAttempts: 3 }),
    );

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("escalated");
    expect(result.reason).toBe("max_attempts_exhausted");
  });

  it("skips when cooldown is still active", async () => {
    const { decideNextAction } = await import("./orchestrator");

    // The most recent transition was 10 minutes ago, cooldown is 60 min.
    mockPrisma.case.findUniqueOrThrow.mockResolvedValue(
      makeCase({
        transitions: [
          {
            reasonCode: "action_scheduled",
            createdAt: new Date(Date.now() - 10 * 60 * 1000),
          },
        ],
      }),
    );
    mockPrisma.recoveryPolicy.findFirst.mockResolvedValue(
      makePolicy({ cooldownMinutes: 60 }),
    );

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("cooldown_active");
  });

  it("skips when contact cap is reached", async () => {
    const { decideNextAction } = await import("./orchestrator");

    // 2 recent contacts for this customer (at the cap of 2).
    mockPrisma.caseTransition.count.mockResolvedValue(2);

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("contact_cap_reached");
  });

  it("skips when case has pending human approval", async () => {
    const { decideNextAction } = await import("./orchestrator");

    mockPrisma.case.findUniqueOrThrow.mockResolvedValue(
      makeCase({
        transitions: [
          {
            reasonCode: "pending_human_approval",
            createdAt: new Date(),
          },
        ],
      }),
    );

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("pending_human_approval");
  });

  it("skips when promise-to-pay date is in the future", async () => {
    const { decideNextAction } = await import("./orchestrator");

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockPrisma.case.findUniqueOrThrow.mockResolvedValue(
      makeCase({ promisedPaymentDate: tomorrow }),
    );

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("promise_to_pay_active");
  });

  it("schedules an action when all guardrails pass", async () => {
    const { decideNextAction } = await import("./orchestrator");

    const result = await decideNextAction("case_test");

    expect(result.action).toBe("scheduled");
    expect(result.reason).toMatch(/action_scheduled|scheduled_for_send_window/);
    // Should have created a ScheduledJob
    expect(mockPrisma.scheduledJob.create).toHaveBeenCalled();
    // Should have updated case to ACTION_SCHEDULED
    expect(mockPrisma.case.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: CaseState.ACTION_SCHEDULED,
        }),
      }),
    );
  });
});

describe("computeRunAt — smart send timing", () => {
  it("returns now when inside the send window", async () => {
    const { computeRunAt } = await import("./orchestrator");

    // Create a date that will be 14:00 IST (inside 9–21 window).
    // 14:00 IST = 08:30 UTC
    const testDate = new Date("2026-08-24T08:30:00.000Z");
    const result = computeRunAt(9, 21, testDate);

    expect(result.getTime()).toBe(testDate.getTime());
  });

  it("delays to next window opening when past the window end", async () => {
    const { computeRunAt } = await import("./orchestrator");

    // Create a date that will be 22:00 IST (past 21:00 window end).
    // 22:00 IST = 16:30 UTC
    const testDate = new Date("2026-08-24T16:30:00.000Z");
    const result = computeRunAt(9, 21, testDate);

    // Should be delayed to 09:00 IST next day = 03:30 UTC next day.
    expect(result.getTime()).toBeGreaterThan(testDate.getTime());
    // The result should be at 09:00 IST = 03:30 UTC on 2026-08-25.
    const expectedRunAt = new Date("2026-08-25T03:30:00.000Z");
    expect(result.getTime()).toBe(expectedRunAt.getTime());
  });

  it("delays to later today when before the window start", async () => {
    const { computeRunAt } = await import("./orchestrator");

    // Create a date that will be 07:00 IST (before 9:00 window start).
    // 07:00 IST = 01:30 UTC
    const testDate = new Date("2026-08-24T01:30:00.000Z");
    const result = computeRunAt(9, 21, testDate);

    // Should be delayed to 09:00 IST same day = 03:30 UTC.
    const expectedRunAt = new Date("2026-08-24T03:30:00.000Z");
    expect(result.getTime()).toBe(expectedRunAt.getTime());
  });
});
