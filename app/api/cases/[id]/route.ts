/**
 * GET /api/cases/[id]
 *
 * Full case detail for the Case Detail page: customer/merchant info,
 * amount, state, cause code, recovery link, and every DraftMessage (with
 * its DeliveryAttempts). The audit timeline itself lives on
 * `GET /api/audit?caseId=...` (Phase 7) — this endpoint is just the case
 * header + drafts. Any signed-in role may read.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const caseRecord = await prisma.case.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { name: true, email: true, phone: true } },
      merchant: { select: { name: true } },
      classifiedCase: { select: { causeCode: true, confidence: true, source: true } },
      recoveryEvent: {
        select: {
          amountPaise: true,
          currency: true,
          scenario: true,
          razorpayRefId: true,
          sourceType: true,
          occurredAt: true,
          dueDate: true,
          rawPayload: true,
        },
      },
      draftMessages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          channel: true,
          language: true,
          subject: true,
          body: true,
          generatedBy: true,
          promptVersion: true,
          createdAt: true,
          deliveryAttempts: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              status: true,
              providerRef: true,
              errorDetail: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!caseRecord) {
    return errorResponse("NOT_FOUND", `Case ${params.id} not found`, 404);
  }

  return successResponse({ case: caseRecord });
}
