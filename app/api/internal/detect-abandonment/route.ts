/**
 * GET /api/internal/detect-abandonment
 *
 * Finds orders that were created but never completed within the grace
 * window, and creates RecoveryEvent + Case rows for them. Gated to
 * ADMIN sessions (Phase 7).
 *
 * The worker (`worker/index.ts`) calls `detectAbandonedCheckouts()`
 * directly on every tick — this endpoint exists for manual triggering
 * and testing.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { detectAbandonedCheckouts } from "@/lib/ingestion/detect-abandonment";
import { requireRole } from "@/lib/auth/requireRole";
import { UserRole } from "@prisma/client";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [UserRole.ADMIN]);
  if (auth.response) return auth.response;

  try {
    const result = await detectAbandonedCheckouts();
    return successResponse(result);
  } catch (error) {
    console.error("[detect-abandonment] Error:", error);
    return errorResponse(
      "DETECTION_ERROR",
      "Failed to run abandonment detection",
      500,
    );
  }
}
