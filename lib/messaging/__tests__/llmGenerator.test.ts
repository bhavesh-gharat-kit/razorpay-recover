/**
 * Tests for the LLM-backed generator's graceful-fallback behavior.
 * The Anthropic SDK client is mocked — these tests never make a real
 * network call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MessageGenerationInput } from "../types";

const mockCreate = vi.fn();

vi.mock("@/lib/env", () => ({
  env: {
    ANTHROPIC_API_KEY: "test-key",
    USE_LLM_DRAFTING: true,
  },
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const input: MessageGenerationInput = {
  caseId: "case_llm_test",
  causeCode: "INSUFFICIENT_FUNDS",
  scenario: "CHECKOUT_DROPOFF",
  channel: "EMAIL",
  language: "EN",
  customerName: "Priya Sharma",
  merchantName: "Chai Point",
  amountPaise: 250000,
  currency: "INR",
  recoveryLink: "https://rzp.io/i/AbCdEfGh",
  attemptNumber: 1,
};

describe("llmGenerator", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns an LLM-generated message when the API call succeeds and includes the link", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            subject: "Quick note about your Chai Point payment",
            body: `Hi Priya, your payment couldn't be processed. Complete it here: ${input.recoveryLink}`,
          }),
        },
      ],
    });

    const { llmGenerator } = await import("../llmGenerator");
    const result = await llmGenerator.generate(input);

    expect(result.generatedBy).toBe("LLM");
    expect(result.promptVersion).toBeTruthy();
    expect(result.body).toContain(input.recoveryLink);
  });

  it("falls back to the template generator when the API call throws", async () => {
    mockCreate.mockRejectedValue(new Error("network timeout"));

    const { llmGenerator } = await import("../llmGenerator");
    const result = await llmGenerator.generate(input);

    expect(result.generatedBy).toBe("TEMPLATE");
    expect(result.body).toContain(input.recoveryLink);
  });

  it("falls back to the template generator when the response drops the recovery link", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            subject: "Payment issue",
            body: "Hi Priya, please try your payment again on our site.",
          }),
        },
      ],
    });

    const { llmGenerator } = await import("../llmGenerator");
    const result = await llmGenerator.generate(input);

    expect(result.generatedBy).toBe("TEMPLATE");
    expect(result.body).toContain(input.recoveryLink);
  });

  it("falls back to the template generator when the response isn't valid JSON", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json at all" }],
    });

    const { llmGenerator } = await import("../llmGenerator");
    const result = await llmGenerator.generate(input);

    expect(result.generatedBy).toBe("TEMPLATE");
  });
});
