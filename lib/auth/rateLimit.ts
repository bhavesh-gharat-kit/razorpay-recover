/**
 * Tiny in-memory IP rate limiter used to slow down brute-force login
 * attempts. Not distributed — resets on process restart, which is fine
 * for this deployment shape (one PM2 web process behind Nginx).
 *
 * Keyed by IP; window and limit are configurable so tests can dial them
 * down without waiting 15 real minutes.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max attempts allowed in the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export const LOGIN_RATE_LIMIT: RateLimitOptions = {
  limit: 5,
  windowMs: 15 * 60 * 1000,
};

/**
 * Per-IP cap on the public /demo endpoints (`/api/demo/order`,
 * `/api/demo/result`). Modest — the demo is meant for judges and internal
 * testing, not open traffic. Read polling on `/api/demo/case/[id]` uses a
 * separate, looser bucket key.
 */
export const DEMO_RATE_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 10 * 60 * 1000,
};

/**
 * Looser cap for the read-polling endpoint (`/api/demo/case/[id]`), which
 * a healthy client hits ~7 times per case at 3s intervals.
 */
export const DEMO_READ_RATE_LIMIT: RateLimitOptions = {
  limit: 200,
  windowMs: 10 * 60 * 1000,
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Record an attempt for `key`, returning whether it's allowed. Attempts
 * beyond `limit` in the window are rejected until `resetAt`.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = LOGIN_RATE_LIMIT,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + options.windowMs };
    buckets.set(key, bucket);
    return {
      allowed: true,
      remaining: options.limit - 1,
      resetAt: bucket.resetAt,
    };
  }

  if (existing.count >= options.limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count++;
  return {
    allowed: true,
    remaining: options.limit - existing.count,
    resetAt: existing.resetAt,
  };
}

/**
 * Successful login should not count against the limiter — call this
 * after a successful auth to wipe the bucket for `key`.
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test hook — clear every bucket. Not intended for production use. */
export function _resetAllRateLimitsForTests(): void {
  buckets.clear();
}
