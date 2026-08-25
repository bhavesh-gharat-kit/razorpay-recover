import { describe, it, expect, vi } from "vitest";
import {
  emitCaseTransition,
  emitBatchSummary,
  emitRecoveryDetected,
} from "../emit";

function makeDb() {
  return { systemEvent: { create: vi.fn().mockResolvedValue(undefined) } };
}

describe("SystemEvent emit helpers", () => {
  it("writes a case_transition row with the given payload", async () => {
    const db = makeDb();
    await emitCaseTransition(db as never, {
      caseId: "case_1",
      fromState: "DETECTED",
      toState: "DIAGNOSED",
      causeCode: "CARD_EXPIRED",
    });

    expect(db.systemEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "case_transition",
        payload: {
          caseId: "case_1",
          fromState: "DETECTED",
          toState: "DIAGNOSED",
          causeCode: "CARD_EXPIRED",
        },
      },
    });
  });

  it("writes a batch_summary row", async () => {
    const db = makeDb();
    await emitBatchSummary(db as never, {
      processed: 3,
      classified: 2,
      scheduled: 1,
      sent: 1,
      recovered: 0,
    });

    expect(db.systemEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "batch_summary",
        payload: { processed: 3, classified: 2, scheduled: 1, sent: 1, recovered: 0 },
      },
    });
  });

  it("writes a recovery_detected row", async () => {
    const db = makeDb();
    await emitRecoveryDetected(db as never, { caseId: "case_2", amountPaise: 12345 });

    expect(db.systemEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "recovery_detected",
        payload: { caseId: "case_2", amountPaise: 12345 },
      },
    });
  });
});
