/**
 * GET /api/internal/detect-abandonment
 *
 * Finds orders that were created but never completed within the grace
 * window, and creates RecoveryEvent + Case rows for them. Protected by
 * `INTERNAL_TASK_SECRET` header check (real auth replaces this in Phase 7).
 *
 * Phase 4's worker will call detectAbandonedCheckouts() directly
 * (imported, not via HTTP) on every tick. This endpoint exists for manual
 * triggering and testing.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { detectAbandonedCheckouts } from "@/lib/ingestion/detect-abandonment";

export async function GET(request: NextRequest) {
  // Verify internal task secret.
  const secret = process.env.INTERNAL_TASK_SECRET ?? "";
  const provided = request.headers.get("x-internal-secret") ?? "";

  if (!secret || provided !== secret) {
    return errorResponse("UNAUTHORIZED", "Invalid or missing internal secret", 401);
  }

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
