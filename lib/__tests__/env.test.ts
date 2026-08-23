import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("env validator", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module registry so env.ts re-evaluates on each import
    // We need to manipulate process.env before the dynamic import
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;
    process.env.JWT_SECRET = "test-secret";

    await expect(async () => {
      // Dynamic import so the module re-evaluates with the modified env
      await import("../env.ts?" + Date.now());
    }).rejects.toThrow("Missing required environment variable: DATABASE_URL");
  });

  it("throws when JWT_SECRET is missing", async () => {
    process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
    delete process.env.JWT_SECRET;

    await expect(async () => {
      await import("../env.ts?" + Date.now());
    }).rejects.toThrow("Missing required environment variable: JWT_SECRET");
  });

  it("throws when USE_LLM_DRAFTING=true but ANTHROPIC_API_KEY is empty", async () => {
    process.env.DATABASE_URL = "mysql://test:test@localhost:3306/test";
    process.env.JWT_SECRET = "test-secret";
    process.env.USE_LLM_DRAFTING = "true";
    delete process.env.ANTHROPIC_API_KEY;

    await expect(async () => {
      await import("../env.ts?" + Date.now());
    }).rejects.toThrow(
      "USE_LLM_DRAFTING=true requires ANTHROPIC_API_KEY to be set",
    );
  });
});
