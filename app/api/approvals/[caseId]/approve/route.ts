/**
 * POST /api/approvals/[caseId]/approve
 *
 * Marks a queued case as human-approved. Writes a CaseTransition
 * (`reasonCode: "human_approved"`, actor: HUMAN) + an AuditLog entry.
 * The case is left in its current state — the orchestrator's next tick
 * picks it up and proceeds through the normal flow now that the amount
 * intercept sees a prior `human_approved`.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { Actor, CaseState, UserRole } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const auth = await requireRole(request, [UserRole.ADMIN, UserRole.REVIEWER]);
  if (auth.response) return auth.response;
  const { session } = auth;

  const { caseId } = params;
  const caseRecord = await prisma.case.findUnique({ where: { id: caseId } });
  if (!caseRecord) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }

  if (
    caseRecord.state === CaseState.RECOVERED ||
    caseRecord.state === CaseState.CLOSED
  ) {
    return errorResponse(
      "INVALID_STATE",
      `Cannot approve a case in ${caseRecord.state}`,
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: caseRecord.state, // no state change; orchestrator advances it
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "human_approved",
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "case_approved",
        reasonCode: "human_approved",
        beforeState: { state: caseRecord.state },
        afterState: { state: caseRecord.state, approvedBy: session.userId },
      },
    });
  });

  return successResponse({ caseId, approvedBy: session.userId });
}
