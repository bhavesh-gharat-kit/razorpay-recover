import { NextResponse } from "next/server";

/**
 * Standard API response envelope. Every API route in Recover returns
 * this shape — no ad-hoc JSON objects.
 */
export type ApiResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/**
 * Build a successful JSON response.
 *
 * @param data   - The payload to wrap in `{ ok: true, data }`.
 * @param status - HTTP status code (default 200).
 */
export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data } satisfies ApiResponse<T>, {
    status,
  });
}

/**
 * Build an error JSON response.
 *
 * @param code    - Machine-readable error code (e.g. `"DB_UNREACHABLE"`).
 * @param message - Human-readable explanation.
 * @param status  - HTTP status code (default 500).
 */
export function errorResponse(
  code: string,
  message: string,
  status = 500,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } } satisfies ApiResponse<never>,
    { status },
  );
}
