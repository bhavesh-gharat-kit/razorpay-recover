/**
 * GET /api/cases
 *
 * Paginated case list for the dashboard's Case Explorer. Any signed-in
 * role may read.
 *
 * Query params:
 *   ?page=1&limit=20
 *   ?state=DIAGNOSED
 *   ?causeCode=CARD_EXPIRED
 *   ?scenario=CHECKOUT_DROPOFF
 *   ?search=<customer name / email / razorpayRefId, case-insensitive LIKE>
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/requireRole";
import { prisma } from "@/lib/db";
import { CaseState, Scenario, UserRole, type Prisma } from "@prisma/client";

const STATES = new Set<string>(Object.values(CaseState));
const SCENARIOS = new Set<string>(Object.values(Scenario));

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const state = searchParams.get("state");
  if (state && !STATES.has(state)) {
    return errorResponse("INVALID_STATE", `Unknown state "${state}"`, 400);
  }

  const scenario = searchParams.get("scenario");
  if (scenario && !SCENARIOS.has(scenario)) {
    return errorResponse("INVALID_SCENARIO", `Unknown scenario "${scenario}"`, 400);
  }

  const causeCode = searchParams.get("causeCode");
  const search = searchParams.get("search")?.trim();

  const where: Prisma.CaseWhereInput = {
    ...(state ? { state: state as CaseState } : {}),
    ...(scenario ? { recoveryEvent: { scenario: scenario as Scenario } } : {}),
    ...(causeCode ? { classifiedCase: { causeCode } } : {}),
    ...(search
      ? {
          OR: [
            { customer: { name: { contains: search } } },
            { customer: { email: { contains: search } } },
            { recoveryEvent: { razorpayRefId: { contains: search } } },
          ],
        }
      : {}),
  };

  const [total, cases] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        state: true,
        attemptCount: true,
        maxAttempts: true,
        updatedAt: true,
        recoveryLinkId: true,
        recoveryLinkUrl: true,
        recoveredAmountPaise: true,
        customer: { select: { name: true, email: true } },
        merchant: { select: { name: true } },
        classifiedCase: { select: { causeCode: true, confidence: true } },
        recoveryEvent: {
          select: { amountPaise: true, currency: true, scenario: true, razorpayRefId: true },
        },
      },
    }),
  ]);

  const items = cases.map((c) => ({
    id: c.id,
    state: c.state,
    attemptCount: c.attemptCount,
    maxAttempts: c.maxAttempts,
    updatedAt: c.updatedAt,
    customerName: c.customer.name,
    customerEmail: c.customer.email,
    merchantName: c.merchant.name,
    amountPaise: c.recoveryEvent.amountPaise,
    currency: c.recoveryEvent.currency,
    scenario: c.recoveryEvent.scenario,
    razorpayRefId: c.recoveryEvent.razorpayRefId,
    causeCode: c.classifiedCase?.causeCode ?? null,
    confidence: c.classifiedCase?.confidence ?? null,
    recoveredAmountPaise: c.recoveredAmountPaise,
    recoveryLinkStatus: !c.recoveryLinkId
      ? ("no_link" as const)
      : c.state === CaseState.RECOVERED
        ? ("link_paid" as const)
        : ("has_link" as const),
    recoveryLinkUrl: c.recoveryLinkUrl,
  }));

  return successResponse({
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}
