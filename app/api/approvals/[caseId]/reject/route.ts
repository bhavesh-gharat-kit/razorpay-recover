/**
 * POST /api/approvals/[caseId]/reject
 *
 * Reviewer decision to NOT pursue recovery on a case — transitions it
 * to CLOSED with `reasonCode: "human_rejected"`.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { Actor, CaseState, UserRole } from "@prisma/client";
import { emitCaseTransition } from "@/lib/events/emit";

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
      `Cannot reject a case in ${caseRecord.state}`,
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: { state: CaseState.CLOSED },
    });
    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: CaseState.CLOSED,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "human_rejected",
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "case_rejected",
        reasonCode: "human_rejected",
        beforeState: { state: caseRecord.state },
        afterState: { state: CaseState.CLOSED, rejectedBy: session.userId },
      },
    });
    await emitCaseTransition(tx, {
      caseId,
      fromState: caseRecord.state,
      toState: CaseState.CLOSED,
      causeCode: null,
    });
  });

  return successResponse({ caseId, state: CaseState.CLOSED });
}
