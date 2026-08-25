import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  // env.ts requires JWT_SECRET at import — set it before importing.
  process.env.JWT_SECRET ??= "test-secret-abc";
  process.env.DATABASE_URL ??= "mysql://x:y@localhost:3306/x";
});

describe("jwt helpers", () => {
  it("round-trips a session payload", async () => {
    const { signSession, verifySession } = await import("../jwt");
    const token = signSession({ userId: "u1", role: "ADMIN" });
    expect(typeof token).toBe("string");
    const decoded = verifySession(token);
    expect(decoded).toMatchObject({ userId: "u1", role: "ADMIN" });
  });

  it("rejects a tampered token", async () => {
    const { signSession, verifySession } = await import("../jwt");
    const token = signSession({ userId: "u1", role: "ADMIN" });
    const tampered = token.slice(0, -4) + "AAAA";
    expect(verifySession(tampered)).toBeNull();
  });

  it("returns null on garbage input", async () => {
    const { verifySession } = await import("../jwt");
    expect(verifySession("")).toBeNull();
    expect(verifySession("not.a.jwt")).toBeNull();
  });
});
