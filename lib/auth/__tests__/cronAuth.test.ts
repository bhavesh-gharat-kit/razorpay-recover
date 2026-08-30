import { describe, it, expect, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { isAuthorizedCron } from "../cronAuth";

function req(headers: Record<string, string> = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

const ORIGINAL = process.env.CRON_SECRET;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe("isAuthorizedCron", () => {
  it("returns false when CRON_SECRET is unset", () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron(req({ authorization: "Bearer anything" }))).toBe(false);
  });

  it("accepts a matching Bearer token", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isAuthorizedCron(req({ authorization: "Bearer s3cret-value" }))).toBe(true);
  });

  it("accepts the raw secret without the Bearer prefix", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isAuthorizedCron(req({ authorization: "s3cret-value" }))).toBe(true);
  });

  it("rejects a wrong token", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isAuthorizedCron(req({ authorization: "Bearer nope" }))).toBe(false);
  });

  it("rejects a token that is a prefix of the secret (length check)", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isAuthorizedCron(req({ authorization: "Bearer s3cret" }))).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(isAuthorizedCron(req())).toBe(false);
  });
});
