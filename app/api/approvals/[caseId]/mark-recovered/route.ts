/**
 * POST /api/approvals/[caseId]/mark-recovered
 *
 * Body: `{ recoveredAmountPaise, note? }`. Marks a case RECOVERED by
 * human action (e.g. the customer paid offline / bank transfer, so the
 * auto-recovery loop never fired). Records the amount and a
 * `reasonCode: "human_marked_recovered"` transition.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { Actor, CaseState, UserRole } from "@prisma/client";
import { emitCaseTransition, emitRecoveryDetected } from "@/lib/events/emit";

interface Body {
  recoveredAmountPaise?: unknown;
  note?: unknown;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const auth = await requireRole(request, [UserRole.ADMIN, UserRole.REVIEWER]);
  if (auth.response) return auth.response;
  const { session } = auth;

  const { caseId } = params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return errorResponse("INVALID_JSON", "Malformed JSON body", 400);
  }

  const amount = Number(body.recoveredAmountPaise);
  if (!Number.isInteger(amount) || amount <= 0) {
    return errorResponse(
      "INVALID_AMOUNT",
      "Body must include a positive integer `recoveredAmountPaise`",
      400,
    );
  }
  const note = typeof body.note === "string" ? body.note : null;

  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    include: { classifiedCase: { select: { causeCode: true } } },
  });
  if (!caseRecord) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }
  if (caseRecord.state === CaseState.RECOVERED) {
    return errorResponse(
      "ALREADY_RECOVERED",
      "Case is already RECOVERED",
      409,
    );
  }
  if (caseRecord.state === CaseState.CLOSED) {
    return errorResponse(
      "INVALID_STATE",
      "Cannot mark a CLOSED case as recovered — reopen it first",
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        state: CaseState.RECOVERED,
        recoveredAmountPaise: amount,
      },
    });
    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: CaseState.RECOVERED,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "human_marked_recovered",
        metadata: { recoveredAmountPaise: amount, note },
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "case_marked_recovered",
        reasonCode: "human_marked_recovered",
        beforeState: {
          state: caseRecord.state,
          recoveredAmountPaise: caseRecord.recoveredAmountPaise,
        },
        afterState: {
          state: CaseState.RECOVERED,
          recoveredAmountPaise: amount,
          note,
        },
      },
    });
    await emitCaseTransition(tx, {
      caseId,
      fromState: caseRecord.state,
      toState: CaseState.RECOVERED,
      causeCode: caseRecord.classifiedCase?.causeCode ?? null,
    });
    await emitRecoveryDetected(tx, { caseId, amountPaise: amount });
  });

  return successResponse({
    caseId,
    state: CaseState.RECOVERED,
    recoveredAmountPaise: amount,
  });
}
