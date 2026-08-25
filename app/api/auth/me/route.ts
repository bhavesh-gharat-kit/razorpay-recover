/**
 * GET /api/auth/me — returns the signed-in user's `{ userId, email, role }`
 * so the dashboard can render an auth-aware shell without a full round-trip.
 * Returns 401 when there is no valid session.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return errorResponse("UNAUTHORIZED", "No active session", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, role: true },
  });

  if (!user) {
    // Token references a deleted user — treat as unauthenticated.
    return errorResponse("UNAUTHORIZED", "User no longer exists", 401);
  }

  return successResponse({
    userId: user.id,
    email: user.email,
    role: user.role,
  });
}
