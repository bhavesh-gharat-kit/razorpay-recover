import { describe, it, expect, vi, beforeEach } from "vitest";

describe("getMessageGenerator — selection logic", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the template generator by default", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { USE_LLM_DRAFTING: false, ANTHROPIC_API_KEY: "" },
    }));
    const { getMessageGenerator } = await import("../index");
    const { templateGenerator } = await import("../templateGenerator");

    expect(getMessageGenerator()).toBe(templateGenerator);
  });

  it("returns the template generator when USE_LLM_DRAFTING is true but no API key is set", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { USE_LLM_DRAFTING: true, ANTHROPIC_API_KEY: "" },
    }));
    const { getMessageGenerator } = await import("../index");
    const { templateGenerator } = await import("../templateGenerator");

    expect(getMessageGenerator()).toBe(templateGenerator);
  });

  it("returns the LLM generator when USE_LLM_DRAFTING is true and a key is set", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { USE_LLM_DRAFTING: true, ANTHROPIC_API_KEY: "sk-test" },
    }));
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        messages = { create: vi.fn() };
      },
    }));
    const { getMessageGenerator } = await import("../index");
    const { llmGenerator } = await import("../llmGenerator");

    expect(getMessageGenerator()).toBe(llmGenerator);
  });
});
