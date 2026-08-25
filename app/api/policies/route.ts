/**
 * GET /api/policies — list every RecoveryPolicy row for the settings
 * panel. Any signed-in role may read (editing is ADMIN-only, see
 * `PATCH /api/policies/[id]`), so REVIEWER/VIEWER can at least see what
 * guardrails are configured.
 */

import { NextRequest } from "next/server";
import { successResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const policies = await prisma.recoveryPolicy.findMany({
    orderBy: [{ scenario: "asc" }, { causeCode: "asc" }, { escalationTier: "asc" }],
  });

  return successResponse({ items: policies });
}
