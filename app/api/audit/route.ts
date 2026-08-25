/**
 * GET /api/audit?caseId=...
 *
 * Returns a chronological timeline (AuditLog + CaseTransition, merged
 * with a human-readable `description` per entry) for a single case.
 * Any signed-in role may read — this is the audit view.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { buildCaseTimeline } from "@/lib/audit/timeline";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get("caseId");
  if (!caseId) {
    return errorResponse("MISSING_CASE_ID", "Query param `caseId` is required", 400);
  }

  const caseExists = await prisma.case.findUnique({
    where: { id: caseId },
    select: { id: true, state: true },
  });
  if (!caseExists) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }

  const timeline = await buildCaseTimeline(caseId);
  return successResponse({
    caseId,
    state: caseExists.state,
    count: timeline.length,
    entries: timeline,
  });
}
