import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  resetRateLimit,
  _resetAllRateLimitsForTests,
} from "../rateLimit";

const OPTS = { limit: 3, windowMs: 60_000 };

describe("checkRateLimit", () => {
  beforeEach(() => _resetAllRateLimitsForTests());

  it("allows requests up to the limit and denies past it", () => {
    for (let i = 0; i < 3; i++) {
      const r = checkRateLimit("ip:1.1.1.1", OPTS);
      expect(r.allowed).toBe(true);
    }
    const denied = checkRateLimit("ip:1.1.1.1", OPTS);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("scopes counts per key", () => {
    checkRateLimit("ip:a", OPTS);
    checkRateLimit("ip:a", OPTS);
    checkRateLimit("ip:a", OPTS);
    const denied = checkRateLimit("ip:a", OPTS);
    expect(denied.allowed).toBe(false);
    // Different key is fresh.
    const ok = checkRateLimit("ip:b", OPTS);
    expect(ok.allowed).toBe(true);
  });

  it("resetRateLimit clears one bucket", () => {
    checkRateLimit("ip:x", OPTS);
    checkRateLimit("ip:x", OPTS);
    checkRateLimit("ip:x", OPTS);
    resetRateLimit("ip:x");
    const r = checkRateLimit("ip:x", OPTS);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("re-opens the bucket after the window elapses", () => {
    const shortOpts = { limit: 1, windowMs: 5 };
    expect(checkRateLimit("ip:short", shortOpts).allowed).toBe(true);
    expect(checkRateLimit("ip:short", shortOpts).allowed).toBe(false);
    // Wait a tick past the window.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit("ip:short", shortOpts).allowed).toBe(true);
        resolve();
      }, 20);
    });
  });
});
