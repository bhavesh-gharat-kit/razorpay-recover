/**
 * Thin wrappers around `jsonwebtoken` — every callsite goes through
 * `signSession` / `verifySession` so token shape and algorithm stay
 * consistent (and swappable) in one place.
 */

import jwt from "jsonwebtoken";
import { env } from "@/lib/env";
import type { UserRole } from "@prisma/client";

export interface SessionPayload {
  userId: string;
  role: UserRole;
}

/** 7-day session lifetime — long enough for a demo, short enough to be sane. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
    if (
      typeof decoded !== "object" ||
      typeof decoded.userId !== "string" ||
      typeof decoded.role !== "string"
    ) {
      return null;
    }
    return { userId: decoded.userId, role: decoded.role as UserRole };
  } catch {
    return null;
  }
}
