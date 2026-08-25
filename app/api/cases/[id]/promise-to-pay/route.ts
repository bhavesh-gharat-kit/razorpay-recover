/**
 * POST /api/cases/[id]/promise-to-pay
 *
 * Body: `{ promisedPaymentDate: "2026-09-15" }`. Sets
 * `Case.promisedPaymentDate` — the orchestrator's existing promise-to-pay
 * guardrail (see `decideNextAction` in lib/orchestrator/orchestrator.ts,
 * wired since Phase 4) already skips any case with a future
 * `promisedPaymentDate`, so no orchestrator change is needed here; once
 * the date passes, escalation resumes on the next tick automatically.
 *
 * Built for the B2B Invoice Overdue scenario (Phase 9) but not restricted
 * to it — a merchant promising payment is a reasonable stall for any
 * scenario.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { Actor, CaseState, UserRole } from "@prisma/client";

interface Body {
  promisedPaymentDate?: unknown;
}

const TERMINAL_STATES: CaseState[] = [CaseState.RECOVERED, CaseState.CLOSED];

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(request, [UserRole.ADMIN, UserRole.REVIEWER]);
  if (auth.response) return auth.response;
  const { session } = auth;

  const { id: caseId } = params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return errorResponse("INVALID_JSON", "Malformed JSON body", 400);
  }

  if (typeof body.promisedPaymentDate !== "string") {
    return errorResponse(
      "INVALID_DATE",
      "Body must include `promisedPaymentDate` as an ISO date string",
      400,
    );
  }
  const promisedPaymentDate = new Date(body.promisedPaymentDate);
  if (Number.isNaN(promisedPaymentDate.getTime())) {
    return errorResponse("INVALID_DATE", "`promisedPaymentDate` is not a valid date", 400);
  }

  const caseRecord = await prisma.case.findUnique({ where: { id: caseId } });
  if (!caseRecord) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }
  if (TERMINAL_STATES.includes(caseRecord.state)) {
    return errorResponse(
      "INVALID_STATE",
      `Cannot log a promise-to-pay on a case in ${caseRecord.state}`,
      409,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: { promisedPaymentDate },
    });
    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: caseRecord.state, // no state change — orchestrator's own guardrail pauses escalation
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "promise_to_pay_logged",
        metadata: { promisedPaymentDate: promisedPaymentDate.toISOString() },
      },
    });
    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "promise_to_pay_logged",
        reasonCode: "promise_to_pay_logged",
        beforeState: { promisedPaymentDate: caseRecord.promisedPaymentDate },
        afterState: { promisedPaymentDate: promisedPaymentDate.toISOString() },
      },
    });
  });

  return successResponse({ caseId, promisedPaymentDate: promisedPaymentDate.toISOString() });
}
