/**
 * Tests for the channel adapter factory — the single place that decides
 * which concrete adapter backs a given channel.
 */

import { describe, it, expect, vi } from "vitest";

// brevoEmailAdapter imports @/lib/env at module load time — mock it so this
// test doesn't need a real DATABASE_URL etc. configured.
vi.mock("@/lib/env", () => ({
  env: { BREVO_API_KEY: "", BREVO_SENDER_EMAIL: "" },
}));

import { getChannelAdapter } from "../index";
import { brevoEmailAdapter } from "../brevoEmailAdapter";
import { smsAdapterStub } from "../smsAdapterStub";

describe("getChannelAdapter", () => {
  it("returns the Brevo adapter for EMAIL", () => {
    expect(getChannelAdapter("EMAIL")).toBe(brevoEmailAdapter);
  });

  it("returns the SMS stub for SMS", () => {
    expect(getChannelAdapter("SMS")).toBe(smsAdapterStub);
  });

  it("returns the SMS stub for WHATSAPP", () => {
    expect(getChannelAdapter("WHATSAPP")).toBe(smsAdapterStub);
  });
});
