/**
 * POST /api/auth/logout — clears the session cookie. Idempotent: safe
 * to call whether or not the caller was actually signed in.
 */

import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/response";
import { clearSessionCookie } from "@/lib/auth/session";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { Actor } from "@prisma/client";

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (session) {
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: session.userId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "logout",
        reasonCode: "user_logout",
      },
    });
  }
  const response = successResponse({ ok: true });
  clearSessionCookie(response);
  return response;
}
