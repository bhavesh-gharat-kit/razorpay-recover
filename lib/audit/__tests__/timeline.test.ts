import { describe, it, expect } from "vitest";
import { describe as describeEntry } from "../timeline";

describe("describe()", () => {
  it("renders a classification success line with cause + confidence", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "classification_succeeded",
      reasonCode: "classified_CARD_EXPIRED",
      afterState: {
        causeCode: "CARD_EXPIRED",
        source: "RULE",
        confidence: 0.97,
      },
    });
    expect(text).toContain("CARD_EXPIRED");
    expect(text).toContain("rule engine");
    expect(text).toContain("0.97");
  });

  it("renders below-threshold with the best guess", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "classification_below_threshold",
      reasonCode: "classified_UNCLASSIFIED",
      afterState: { causeCode: "UNCLASSIFIED" },
    });
    expect(text).toMatch(/below.*threshold/i);
    expect(text).toContain("UNCLASSIFIED");
  });

  it("renders a scheduled action line with the payment link ID", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "action_scheduled",
      reasonCode: "action_scheduled",
      afterState: { action: "RETRY_LINK", recoveryLinkId: "plink_123" },
    });
    expect(text).toContain("RETRY_LINK");
    expect(text).toContain("plink_123");
  });

  it("renders a reclassification with old→new cause codes", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "case_reclassified",
      reasonCode: "human_reclassified",
      beforeState: { causeCode: "INSUFFICIENT_FUNDS" },
      afterState: { causeCode: "GATEWAY_TIMEOUT" },
    });
    expect(text).toContain("INSUFFICIENT_FUNDS");
    expect(text).toContain("GATEWAY_TIMEOUT");
  });

  it("renders delivery success with providerRef", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "delivery_attempted",
      reasonCode: "delivery_sent",
      afterState: { status: "SENT", providerRef: "brevo-msg-1" },
    });
    expect(text).toMatch(/delivered/i);
    expect(text).toContain("brevo-msg-1");
  });

  it("renders delivery failure with error detail", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "delivery_attempted",
      reasonCode: "delivery_failed",
      afterState: { status: "FAILED", errorDetail: "network_error" },
    });
    expect(text).toMatch(/failed/i);
    expect(text).toContain("network_error");
  });

  it("falls back for an unknown action", () => {
    const text = describeEntry({
      source: "AuditLog",
      action: "some_new_thing",
      reasonCode: null,
    });
    expect(text).toBe("some_new_thing");
  });

  it("falls back to state-change format for a plain transition", () => {
    const text = describeEntry({
      source: "CaseTransition",
      action: "custom_reason",
      reasonCode: "custom_reason",
      fromState: "DIAGNOSED",
      toState: "ESCALATED",
    });
    expect(text).toContain("Diagnosed");
    expect(text).toContain("Escalated");
  });
});
