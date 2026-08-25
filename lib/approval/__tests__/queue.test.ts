/**
 * Unit test for the queue's classification-behavior: we verify the
 * `HUMAN_RESOLUTION_REASONS` set has the reason codes the approval
 * routes actually write. If either side drifts, this test catches it.
 */

import { describe, it, expect } from "vitest";
import { HUMAN_RESOLUTION_REASONS } from "../queue";

describe("HUMAN_RESOLUTION_REASONS", () => {
  it("covers every reason the approval routes emit", () => {
    // These MUST stay in sync with:
    //   app/api/approvals/[caseId]/approve/route.ts       -> human_approved
    //   app/api/approvals/[caseId]/reject/route.ts        -> human_rejected
    //   app/api/approvals/[caseId]/reclassify/route.ts    -> human_reclassified
    //   app/api/approvals/[caseId]/mark-recovered/route.ts -> human_marked_recovered
    for (const reason of [
      "human_approved",
      "human_rejected",
      "human_reclassified",
      "human_marked_recovered",
    ]) {
      expect(HUMAN_RESOLUTION_REASONS.has(reason)).toBe(true);
    }
  });
});
