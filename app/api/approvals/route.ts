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

  const allItems = await getApprovalQueue(filters);

  // Pagination
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "25", 10) || 25));

  // Sort: ?sort=amount_asc | amount_desc | newest | oldest
  const sort = searchParams.get("sort");
  if (sort === "amount_asc") {
    allItems.sort((a, b) => a.amountPaise - b.amountPaise);
  } else if (sort === "amount_desc") {
    allItems.sort((a, b) => b.amountPaise - a.amountPaise);
  } else if (sort === "oldest") {
    allItems.sort((a, b) => a.latestTransitionAt.getTime() - b.latestTransitionAt.getTime());
  }
  // default (newest) is already the sort order from getApprovalQueue

  const total = allItems.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const items = allItems.slice(start, start + limit);

  return successResponse({ count: total, items, page, limit, totalPages });
}
