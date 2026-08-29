/**
 * Tests for the Brevo email adapter's response mapping and daily-counter
 * warning. Mocks global `fetch` — no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseInput = {
  channel: "EMAIL" as const,
  to: { email: "customer@example.com", name: "Test Customer" },
  subject: "Complete your payment",
  body: "Please pay via https://rzp.io/i/abc123 to complete your order.",
  metadata: { caseId: "case_1", merchantName: "Acme Store" },
};

function mockConfiguredEnv() {
  vi.doMock("@/lib/env", () => ({
    env: {
      BREVO_API_KEY: "test-api-key",
      BREVO_SENDER_EMAIL: "sender@example.com",
    },
  }));
}

describe("brevoEmailAdapter", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps a 201 response to SENT with the Brevo messageId", async () => {
    mockConfiguredEnv();
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse(201, { messageId: "brevo-msg-1" }));

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const result = await brevoEmailAdapter.send(baseInput);

    expect(result).toEqual({ status: "SENT", providerRef: "brevo-msg-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps a 400 response to FAILED without retrying", async () => {
    mockConfiguredEnv();
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(jsonResponse(400, { message: "Invalid recipient email" }));

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const result = await brevoEmailAdapter.send(baseInput);

    expect(result.status).toBe("FAILED");
    expect(result.errorDetail).toBe("Invalid recipient email");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no retry on 4xx
  });

  it("retries once on 500 and returns FAILED if the retry also fails", async () => {
    vi.useFakeTimers();
    mockConfiguredEnv();
    // mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response — a Response body can only be read once.
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockImplementation(async () =>
        jsonResponse(500, { message: "Internal server error" }),
      );

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const sendPromise = brevoEmailAdapter.send(baseInput);

    await vi.advanceTimersByTimeAsync(2_000); // past the retry delay
    const result = await sendPromise;

    expect(result.status).toBe("FAILED");
    expect(result.errorDetail).toBe("Internal server error");
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("succeeds on retry after an initial 500", async () => {
    vi.useFakeTimers();
    mockConfiguredEnv();
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse(500, { message: "Internal server error" }))
      .mockResolvedValueOnce(jsonResponse(201, { messageId: "brevo-msg-2" }));

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const sendPromise = brevoEmailAdapter.send(baseInput);

    await vi.advanceTimersByTimeAsync(2_000);
    const result = await sendPromise;

    expect(result).toEqual({ status: "SENT", providerRef: "brevo-msg-2" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns FAILED with network_error on a thrown/aborted fetch", async () => {
    mockConfiguredEnv();
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const result = await brevoEmailAdapter.send(baseInput);

    expect(result).toEqual({ status: "FAILED", errorDetail: "network_error" });
  });

  it("fails gracefully (no crash) when Brevo credentials are missing", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { BREVO_API_KEY: "", BREVO_SENDER_EMAIL: "" },
    }));
    const fetchMock = vi.spyOn(global, "fetch");

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const result = await brevoEmailAdapter.send(baseInput);

    expect(result.status).toBe("FAILED");
    expect(result.errorDetail).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails gracefully (no crash) with an invalid API key (401 from Brevo)", async () => {
    mockConfiguredEnv();
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse(401, { message: "Key not found", code: "unauthorized" }),
    );

    const { brevoEmailAdapter } = await import("../brevoEmailAdapter");
    const result = await brevoEmailAdapter.send(baseInput);

    expect(result.status).toBe("FAILED");
    expect(result.errorDetail).toBe("Key not found");
  });

  it("warns once the daily send count crosses the (lowered) threshold", async () => {
    mockConfiguredEnv();
    // mockImplementation (not mockResolvedValue) so each of the 3 sends
    // below gets a fresh Response — a Response body can only be read once.
    vi.spyOn(global, "fetch").mockImplementation(async () =>
      jsonResponse(201, { messageId: "brevo-msg-x" }),
    );
    // `vi.resetModules()` in `beforeEach` means a dynamic `import("../brevoEmailAdapter")`
    // resolves `@/lib/logger` against a fresh module registry — so the spy has
    // to be set on that same fresh `logger` instance, not the one imported
    // statically at the top of this file.
    const { logger: freshLogger } = await import("@/lib/logger");
    const warnSpy = vi.spyOn(freshLogger, "warn").mockImplementation(() => undefined as never);

    const { brevoEmailAdapter, setDailyWarningThresholdForTests } =
      await import("../brevoEmailAdapter");

    setDailyWarningThresholdForTests(3);

    await brevoEmailAdapter.send(baseInput);
    await brevoEmailAdapter.send(baseInput);
    expect(warnSpy).not.toHaveBeenCalled();

    await brevoEmailAdapter.send(baseInput); // 3rd send crosses the threshold
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sentToday: 3 }),
      expect.stringContaining("approaching Brevo's free-tier limit"),
    );
  });
});
