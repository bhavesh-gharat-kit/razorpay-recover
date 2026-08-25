/**
 * PATCH /api/approvals/[caseId]/edit-draft
 *
 * Body: `{ draftMessageId, body, subject? }`. Overwrites the specified
 * DraftMessage's body/subject — allowed only when NO DeliveryAttempt has
 * been recorded against that draft yet. The AuditLog records the full
 * before/after so the edit is traceable.
 *
 * A case may have multiple drafts (one per attempt). The reviewer picks
 * the one to edit by id.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { Actor, UserRole } from "@prisma/client";

interface Body {
  draftMessageId?: unknown;
  body?: unknown;
  subject?: unknown;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const auth = await requireRole(request, [UserRole.ADMIN, UserRole.REVIEWER]);
  if (auth.response) return auth.response;
  const { session } = auth;

  const { caseId } = params;
  let parsed: Body;
  try {
    parsed = (await request.json()) as Body;
  } catch {
    return errorResponse("INVALID_JSON", "Malformed JSON body", 400);
  }

  const draftMessageId =
    typeof parsed.draftMessageId === "string" ? parsed.draftMessageId : null;
  const newBody = typeof parsed.body === "string" ? parsed.body : null;
  const newSubject =
    typeof parsed.subject === "string"
      ? parsed.subject
      : parsed.subject === undefined
        ? undefined
        : null;

  if (!draftMessageId || !newBody) {
    return errorResponse(
      "MISSING_FIELDS",
      "Body must include `draftMessageId` and non-empty `body`",
      400,
    );
  }
  if (newBody.trim().length === 0) {
    return errorResponse("EMPTY_BODY", "Draft body cannot be empty", 400);
  }

  const draft = await prisma.draftMessage.findUnique({
    where: { id: draftMessageId },
    include: { deliveryAttempts: { select: { id: true } } },
  });

  if (!draft) {
    return errorResponse("NOT_FOUND", `DraftMessage ${draftMessageId} not found`, 404);
  }
  if (draft.caseId !== caseId) {
    return errorResponse(
      "MISMATCH",
      `Draft ${draftMessageId} does not belong to case ${caseId}`,
      400,
    );
  }
  if (draft.deliveryAttempts.length > 0) {
    return errorResponse(
      "ALREADY_SENT",
      "Cannot edit a draft that already has a delivery attempt",
      409,
    );
  }

  const before = { subject: draft.subject, body: draft.body };
  const caseRecord = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { state: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.draftMessage.update({
      where: { id: draftMessageId },
      data: {
        body: newBody,
        // Only touch subject when the caller sent one — undefined means "leave".
        ...(newSubject === undefined ? {} : { subject: newSubject }),
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: caseRecord.state,
        toState: caseRecord.state,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        reasonCode: "draft_edited",
        metadata: { draftMessageId },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "DraftMessage",
        entityId: draftMessageId,
        actor: Actor.HUMAN,
        actorUserId: session.userId,
        action: "draft_edited",
        reasonCode: "human_edit",
        beforeState: before,
        afterState: { subject: updated.subject, body: updated.body },
      },
    });

    return updated;
  });

  return successResponse({
    draftMessageId,
    caseId,
    subject: updated.subject,
    body: updated.body,
  });
}
