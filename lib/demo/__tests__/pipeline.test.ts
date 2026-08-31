/**
 * Tests for `runDemoPipeline` — the synchronous classify → decide →
 * execute driver used by the /demo flow. Uses mocked stages so the
 * pipeline's own orchestration is tested in isolation from the real
 * classifier / orchestrator internals.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { JobStatus } from "@prisma/client";

const mockPrisma = {
  case: {
    findUniqueOrThrow: vi.fn(),
  },
  scheduledJob: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockClassify = vi.fn();
vi.mock("@/lib/classification/classify", () => ({
  classifyRecoveryEvent: mockClassify,
}));

const mockDecide = vi.fn();
const mockExecute = vi.fn();
vi.mock("@/lib/orchestrator/orchestrator", () => ({
  decideNextAction: mockDecide,
  executeScheduledAction: mockExecute,
}));

describe("runDemoPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs classify → decide → execute and returns the final state", async () => {
    // First findUniqueOrThrow returns id + recoveryEventId; second returns final state.
    mockPrisma.case.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: "case_1",
        recoveryEventId: "re_1",
        state: "DETECTED",
      })
      .mockResolvedValueOnce({ state: "ACTION_SENT" });

    mockClassify.mockResolvedValueOnce({
      causeCode: "INSUFFICIENT_FUNDS",
      confidence: 0.95,
      transitioned: true,
    });
    mockDecide.mockResolvedValueOnce({
      action: "scheduled",
      reason: "action_scheduled",
    });
    mockPrisma.scheduledJob.findFirst.mockResolvedValueOnce({
      id: "job_1",
      payload: { caseId: "case_1", action: "RETRY_LINK", recoveryLinkUrl: "url" },
    });
    mockExecute.mockResolvedValueOnce(undefined);

    const { runDemoPipeline } = await import("../pipeline");
    const result = await runDemoPipeline("case_1");

    expect(mockClassify).toHaveBeenCalledWith("re_1");
    expect(mockDecide).toHaveBeenCalledWith("case_1");
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: "case_1", action: "RETRY_LINK" }),
    );
    expect(mockPrisma.scheduledJob.update).toHaveBeenLastCalledWith({
      where: { id: "job_1" },
      data: { status: JobStatus.DONE, lockedAt: null },
    });
    expect(result.finalState).toBe("ACTION_SENT");
    expect(result.steps).toContain("executed");
  });

  it("returns the parked state when the case is held for approval (no pending job)", async () => {
    mockPrisma.case.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: "case_2",
        recoveryEventId: "re_2",
        state: "DIAGNOSED",
      })
      .mockResolvedValueOnce({ state: "DIAGNOSED" });

    mockClassify.mockResolvedValueOnce({
      causeCode: "INSUFFICIENT_FUNDS",
      confidence: 0.95,
      transitioned: true,
    });
    mockDecide.mockResolvedValueOnce({
      action: "skipped",
      reason: "pending_human_approval",
    });
    mockPrisma.scheduledJob.findFirst.mockResolvedValueOnce(null);

    const { runDemoPipeline } = await import("../pipeline");
    const result = await runDemoPipeline("case_2");

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.finalState).toBe("DIAGNOSED");
    expect(result.steps).toContain("no_pending_job");
    expect(result.steps.some((s) => s.includes("pending_human_approval"))).toBe(true);
  });

  it("marks the job FAILED when execute throws, without leaving it PROCESSING", async () => {
    mockPrisma.case.findUniqueOrThrow
      .mockResolvedValueOnce({
        id: "case_3",
        recoveryEventId: "re_3",
        state: "DIAGNOSED",
      })
      .mockResolvedValueOnce({ state: "ACTION_SCHEDULED" });

    mockClassify.mockResolvedValueOnce({
      causeCode: "GATEWAY_TIMEOUT",
      confidence: 0.9,
      transitioned: true,
    });
    mockDecide.mockResolvedValueOnce({
      action: "scheduled",
      reason: "action_scheduled",
    });
    mockPrisma.scheduledJob.findFirst.mockResolvedValueOnce({
      id: "job_3",
      payload: { caseId: "case_3", action: "RETRY_LINK", recoveryLinkUrl: "url" },
    });
    mockExecute.mockRejectedValueOnce(new Error("boom"));

    const { runDemoPipeline } = await import("../pipeline");
    const result = await runDemoPipeline("case_3");

    expect(mockPrisma.scheduledJob.update).toHaveBeenLastCalledWith({
      where: { id: "job_3" },
      data: {
        status: JobStatus.FAILED,
        lastError: "boom",
        lockedAt: null,
      },
    });
    expect(result.steps).toContain("execute_failed");
  });
});
