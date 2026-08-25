/**
 * POST /api/approvals/[caseId]/reclassify
 *
 * Body: `{ causeCode }`. Creates a NEW ClassifiedCase with
 * `source: HUMAN, confidence: 1.0`, re-links it to the case, and
 * transitions the case back into DIAGNOSED so the orchestrator can
 * re-run with the corrected cause on its next tick.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import {
  Actor,
  CaseState,
  ClassificationSource,
  UserRole,
} from "@prisma/client";
import { emitCaseTransition } from "@/lib/events/emit";

interface Body {
  causeCode?: unknown;
}

/** Cause codes the classifier already knows about. Free-form is allowed
 *  because Phase 9 introduces additional cause codes and we don't want
 *  a hardcoded whitelist to block that. We do reject empty strings. */
function validCauseCode(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
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

  if (!validCauseCode(body.causeCode)) {
    return errorResponse(
      "INVALID_CAUSE_CODE",
      "Body must include a non-empty `causeCode` string",
      400,
    );
  }
  const causeCode = body.causeCode.trim().toUpperCase();

  const caseRecord = await prisma.case.findUnique({
    where: { id: caseId },
    include: { classifiedCase: true },
  });
  if (!caseRecord) {
    return errorResponse("NOT_FOUND", `Case ${caseId} not found`, 404);
  }
  if (
    caseRecord.state === CaseState.RECOVERED ||
    caseRecord.state === CaseState.CLOSED
  ) {
    return errorResponse(
      "INVALID_STATE",
      `Cannot reclassify a case in ${caseRecord.state}`,
      409,
    );
  }

  // The old ClassifiedCase is left intact — we DO NOT edit it. Instead we
  // create a fresh one owned by the same RecoveryEvent. Because
  // `recoveryEventId` is unique on ClassifiedCase, we detach the old one
  // by clearing the case's `classifiedCaseId` and then removing the old
  // row so the new one can take its place. The audit trail preserves the
  // change via `beforeState`.
  const oldClassifiedCaseId = caseRecord.classifiedCaseId;
  const oldCauseCode = caseRecord.classifiedCase?.causeCode ?? null;

  const newClassifiedCase = await prisma.$transaction(async (tx) => {
    // Detach the old classification from the Case, then delete the row so
    // the RecoveryEvent's unique constraint can accept the new one.
    if (oldClassifiedCaseId) {
      await tx.case.update({
        where: { id: caseId },
        data: { classifiedCaseId: null },
      });
      await tx.classifiedCase.delete({ where: { id: oldClassifiedCaseId } });
    }

    const newClassifiedCase = await tx.classifiedCase.create({
      data: {
        recoveryEventId: caseRecord.recoveryEventId,
        causeCode,
        confidence: 1.0,
        source: ClassificationSource.HUMAN,
      },
    });

    // Re-link the case, snap state back to DIAGNOSED so decideNextAction
    // will process it on the next tick, and clear the "pending approval"
    // stickiness by writing a fresh transition on top.
    await tx.case.update({
      where: { id: caseId },
      data: {
        classifiedCaseId: newClassifiedCase.id,
        state: CaseState.DIAGNOSED,
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: CaseState.DIAGNOSED,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "human_reclassified",
        metadata: {
          previousCauseCode: oldCauseCode,
          newCauseCode: causeCode,
          newClassifiedCaseId: newClassifiedCase.id,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "case_reclassified",
        reasonCode: "human_reclassified",
        beforeState: {
          state: caseRecord.state,
          classifiedCaseId: oldClassifiedCaseId,
          causeCode: oldCauseCode,
        },
        afterState: {
          state: CaseState.DIAGNOSED,
          classifiedCaseId: newClassifiedCase.id,
          causeCode,
          source: ClassificationSource.HUMAN,
        },
      },
    });

    await emitCaseTransition(tx, {
      caseId,
      fromState: caseRecord.state,
      toState: CaseState.DIAGNOSED,
      causeCode,
    });

    return newClassifiedCase;
  });

  return successResponse({
    caseId,
    classifiedCaseId: newClassifiedCase.id,
    causeCode,
    source: ClassificationSource.HUMAN,
  });
}
