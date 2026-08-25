/**
 * `requireRole` — the single gate every protected API route calls first.
 *
 * Returns the session payload on success, or a `NextResponse` (401/403)
 * the route should return directly. Discriminates on the `.session`
 * field so the caller doesn't have to introspect the response.
 */

import type { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { errorResponse } from "@/lib/api/response";
import { getSession } from "./session";
import type { SessionPayload } from "./jwt";

export type RequireRoleResult =
  | { session: SessionPayload; response: null }
  | { session: null; response: NextResponse };

export async function requireRole(
  request: NextRequest,
  roles: UserRole[],
): Promise<RequireRoleResult> {
  const session = await getSession(request);
  if (!session) {
    return {
      session: null,
      response: errorResponse(
        "UNAUTHORIZED",
        "Authentication required",
        401,
      ),
    };
  }
  if (!roles.includes(session.role)) {
    return {
      session: null,
      response: errorResponse(
        "FORBIDDEN",
        `Requires one of role(s): ${roles.join(", ")}`,
        403,
      ),
    };
  }
  return { session, response: null };
}
