/**
 * POST /api/internal/classify-pending
 *
 * Finds all Case rows still in DETECTED state with no ClassifiedCase yet,
 * runs classifyRecoveryEvent on each, and returns a summary.
 *
 * Gated to ADMIN sessions (Phase 7).
 *
 * Phase 4's worker will call classifyRecoveryEvent() directly (imported,
 * not via HTTP) on every tick. This endpoint exists for manual triggering
 * and testing.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { prisma } from "@/lib/db";
import { classifyRecoveryEvent } from "@/lib/classification/classify";
import { CaseState, UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth/requireRole";

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, [UserRole.ADMIN]);
  if (auth.response) return auth.response;

  try {
    // Find all DETECTED cases without a ClassifiedCase
    const pendingCases = await prisma.case.findMany({
      where: {
        state: CaseState.DETECTED,
        classifiedCaseId: null,
      },
      select: {
        id: true,
        recoveryEventId: true,
      },
    });

    let classified = 0;
    let sentToReview = 0;
    const errors: { caseId: string; error: string }[] = [];

    for (const c of pendingCases) {
      try {
        const result = await classifyRecoveryEvent(c.recoveryEventId);
        if (result.transitioned) {
          classified++;
        } else {
          sentToReview++;
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        errors.push({ caseId: c.id, error: message });
      }
    }

    return successResponse({
      processed: pendingCases.length,
      classified,
      sentToReview,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[classify-pending] Error:", error);
    return errorResponse(
      "CLASSIFICATION_ERROR",
      "Failed to run classification",
      500,
    );
  }
}
