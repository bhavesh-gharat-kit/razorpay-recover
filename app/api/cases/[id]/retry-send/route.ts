/**
 * POST /api/cases/[id]/retry-send
 *
 * Dashboard "Retry Send" action for a case whose last delivery attempt
 * failed. Creates a new `ScheduledJob` (`execute_recovery_action`) with
 * `runAt: now` so the worker picks it up on its next tick, instead of
 * waiting out the policy cooldown. ADMIN or REVIEWER only.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { prisma } from "@/lib/db";
import { Actor, CaseState, JobStatus, UserRole } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(request, [UserRole.ADMIN, UserRole.REVIEWER]);
  if (auth.response) return auth.response;
  const { session } = auth;

  const caseId = params.id;
  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    include: { classifiedCase: { select: { causeCode: true } }, recoveryEvent: true },
  });
  if (!caseRecord) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }
  if (caseRecord.state !== CaseState.ACTION_SCHEDULED) {
    return errorResponse(
      "INVALID_STATE",
      `Retry Send requires state ACTION_SCHEDULED (case is ${caseRecord.state})`,
      409,
    );
  }
  if (!caseRecord.recoveryLinkUrl) {
    return errorResponse(
      "NO_RECOVERY_LINK",
      "Case has no recovery link to send",
      409,
    );
  }

  // Reuse the same policy lookup decideNextAction/sendDraftAndTransition
  // use to pick an action, so a manual retry sends the same kind of
  // message the automated flow would have.
  const policy = caseRecord.classifiedCase
    ? await prisma.recoveryPolicy.findFirst({
        where: {
          scenario: caseRecord.recoveryEvent.scenario,
          causeCode: caseRecord.classifiedCase.causeCode,
          active: true,
        },
      })
    : null;
  const action = (policy?.allowedActions as string[] | undefined)?.[0] ?? "RETRY_LINK";

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduledJob.create({
      data: {
        caseId,
        jobType: "execute_recovery_action",
        payload: { caseId, action, recoveryLinkUrl: caseRecord.recoveryLinkUrl },
        runAt: new Date(),
        status: JobStatus.PENDING,
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: caseRecord.state,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "human_retry_send",
        metadata: { scheduledJobId: created.id },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "retry_send_requested",
        reasonCode: "human_retry_send",
        afterState: { scheduledJobId: created.id, runAt: created.runAt },
      },
    });

    return created;
  });

  return successResponse({ caseId, scheduledJobId: job.id, runAt: job.runAt });
}
