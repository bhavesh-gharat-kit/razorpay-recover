/**
 * GET /api/analytics/summary
 *
 * Query params (all optional):
 *   - scenario: CHECKOUT_DROPOFF | SUBSCRIPTION_FAILURE | INVOICE_OVERDUE
 *   - from:     ISO 8601 timestamp (inclusive)
 *   - to:       ISO 8601 timestamp (inclusive)
 *
 * Returns headline numbers plus cause / channel / daily breakdowns.
 * Any signed-in role may read.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import {
  computeAnalyticsSummary,
  type SummaryFilters,
} from "@/lib/analytics/summary";
import { Scenario, UserRole } from "@prisma/client";

const SCENARIOS = new Set<string>(Object.values(Scenario));

function parseDateParam(s: string | null, name: string): Date | null | { error: string } {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return { error: `Invalid \`${name}\` — expected ISO 8601 timestamp` };
  }
  return d;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const filters: SummaryFilters = {};

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

  const from = parseDateParam(searchParams.get("from"), "from");
  if (from && "error" in from) return errorResponse("INVALID_FROM", from.error, 400);
  if (from) filters.from = from;

  const to = parseDateParam(searchParams.get("to"), "to");
  if (to && "error" in to) return errorResponse("INVALID_TO", to.error, 400);
  if (to) filters.to = to;

  const summary = await computeAnalyticsSummary(filters);
  return successResponse(summary);
}
