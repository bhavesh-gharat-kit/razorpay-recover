/**
 * GET /api/approvals
 *
 * Returns cases currently in the human-approval queue. Optional query
 * params: `?scenario=CHECKOUT_DROPOFF`, `?reason=amount_over_threshold`.
 *
 * ADMIN or REVIEWER only — VIEWERs can read cases via other endpoints
 * but can't act on the queue.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import {
  getApprovalQueue,
  type ApprovalFilters,
  type ApprovalReason,
} from "@/lib/approval/queue";
import { Scenario, UserRole } from "@prisma/client";

const SCENARIOS = new Set<string>(Object.values(Scenario));
const REASONS = new Set<ApprovalReason>([
  "below_threshold",
  "amount_over_threshold",
  "escalated",
]);

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [UserRole.ADMIN, UserRole.REVIEWER]);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const filters: ApprovalFilters = {};

  const scenario = searchParams.get("scenario");
  if (scenario) {
    if (!SCENARIOS.has(scenario)) {
      return errorResponse(
        "INVALID_SCENARIO",
        `Unknown scenario "${scenario}"`,
        400,
      );
    }
    filters.scenario = scenario as Scenario;
  }

  const reason = searchParams.get("reason");
  if (reason) {
    if (!REASONS.has(reason as ApprovalReason)) {
      return errorResponse(
        "INVALID_REASON",
        `Unknown reason "${reason}"`,
        400,
      );
    }
    filters.reason = reason as ApprovalReason;
  }

  const items = await getApprovalQueue(filters);
  return successResponse({ count: items.length, items });
}
