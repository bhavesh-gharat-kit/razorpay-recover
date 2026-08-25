/**
 * POST /api/auth/login
 *
 * Body: `{ email, password }`. On success, sets the session cookie and
 * returns `{ userId, role }`. Rate-limited by client IP to 5 attempts
 * per 15 minutes (per `LOGIN_RATE_LIMIT`) to slow brute force.
 *
 * Every attempt — success or failure — is written to the AuditLog so a
 * reviewer can see who tried to log in and when.
 */

import { NextRequest, NextResponse } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import {
  LOGIN_RATE_LIMIT,
  checkRateLimit,
  resetRateLimit,
} from "@/lib/auth/rateLimit";
import { Actor } from "@prisma/client";

/** Best-effort client IP extraction (Nginx sets x-forwarded-for). */
function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const rl = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: `Too many login attempts. Retry in ${retryAfter}s.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return errorResponse("INVALID_JSON", "Malformed JSON body", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return errorResponse(
      "MISSING_CREDENTIALS",
      "Both email and password are required",
      400,
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    // Constant-ish behavior for both branches — log the failure and return
    // a generic error so we don't leak whether the email exists.
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: user?.id ?? "unknown",
        actor: Actor.HUMAN,
        actorUserId: user?.id ?? null,
        action: "login_failed",
        reasonCode: user ? "bad_password" : "unknown_email",
        afterState: { email, ip },
      },
    });
    return errorResponse("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }

  // Success — clear the bucket so a legit user isn't punished for a typo.
  resetRateLimit(`login:${ip}`);

  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: user.id,
      actor: Actor.HUMAN,
      actorUserId: user.id,
      action: "login_succeeded",
      reasonCode: "credentials_verified",
      afterState: { email: user.email, role: user.role, ip },
    },
  });

  const response = successResponse({ userId: user.id, role: user.role });
  setSessionCookie(response, { userId: user.id, role: user.role });
  return response;
}
