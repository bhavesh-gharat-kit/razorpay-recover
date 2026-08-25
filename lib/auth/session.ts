/**
 * Session cookie helpers for JWT-based auth.
 *
 * The session token lives in an httpOnly, sameSite=strict cookie so it
 * cannot be read from JavaScript and won't be sent on cross-site requests
 * (mitigating CSRF for our own state-changing endpoints).
 */

import type { NextRequest } from "next/server";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_TTL_SECONDS,
  signSession,
  verifySession,
  type SessionPayload,
} from "./jwt";
import { env } from "@/lib/env";

export const SESSION_COOKIE_NAME = "recover_session";

/**
 * Read + verify the JWT cookie from a request. Returns `null` when the
 * cookie is missing or the token is invalid/expired.
 */
export async function getSession(
  request: NextRequest,
): Promise<SessionPayload | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Same as `getSession`, but for Server Components / layouts, which don't
 * receive a `NextRequest` — they read the incoming request's cookies via
 * `next/headers` instead. Used by the dashboard's auth-gated layout.
 */
export function getSessionFromCookieStore(): SessionPayload | null {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Attach a fresh session cookie to the given response. */
export function setSessionCookie(
  response: NextResponse,
  payload: SessionPayload,
): void {
  const token = signSession(payload);
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Clear the session cookie on the given response. */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}
