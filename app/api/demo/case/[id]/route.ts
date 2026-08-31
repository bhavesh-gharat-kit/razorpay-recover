/**
 * GET /api/demo/case/[id]
 *
 * Public, unauthenticated read of a single demo-originated case for the
 * embedded timeline on `/demo`. The `sourceType IN (demo_*)` guard on
 * the underlying RecoveryEvent is the whole security boundary — without
 * it, this endpoint would leak arbitrary internal cases to anyone with
 * an id.
 *
 * Rate-limited on a separate, looser bucket than /api/demo/order|result:
 * this endpoint is polled (every 3s) while the /demo UI waits for a
 * terminal state, so the same "20 in 10 min" the mutating endpoints get
 * would kick in a couple of polls into normal use.
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
import {
  checkRateLimit,
  DEMO_READ_RATE_LIMIT,
} from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/db";
import { buildCaseTimeline } from "@/lib/audit/timeline";
import {
  DEMO_SOURCE_TYPES,
  getRequestIp,
  maskEmail,
} from "@/lib/demo/shared";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const ip = getRequestIp(request);
  const rl = checkRateLimit(`demo-case:${ip}`, DEMO_READ_RATE_LIMIT);
  if (!rl.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "Too many polls — try again in a few minutes",
      429,
    );
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { email: true } },
      classifiedCase: {
        select: { causeCode: true, confidence: true, source: true },
      },
      recoveryEvent: {
        select: {
          amountPaise: true,
          currency: true,
          scenario: true,
          sourceType: true,
        },
      },
    },
  });

  // Enforce the demo-source guard — anything not tagged as a demo event
  // gets the same 404 as a non-existent case id, so this endpoint can't
  // be used as an oracle to check whether a given case id exists.
  if (
    !caseRecord ||
    !DEMO_SOURCE_TYPES.includes(
      caseRecord.recoveryEvent.sourceType as (typeof DEMO_SOURCE_TYPES)[number],
    )
  ) {
    return errorResponse("NOT_FOUND", "Case not found", 404);
  }

  const timeline = await buildCaseTimeline(params.id);

  return successResponse({
    caseId: caseRecord.id,
    state: caseRecord.state,
    scenario: caseRecord.recoveryEvent.scenario,
    causeCode: caseRecord.classifiedCase?.causeCode ?? null,
    confidence: caseRecord.classifiedCase?.confidence ?? null,
    classificationSource: caseRecord.classifiedCase?.source ?? null,
    amountPaise: caseRecord.recoveryEvent.amountPaise,
    currency: caseRecord.recoveryEvent.currency,
    customerEmailMasked: maskEmail(caseRecord.customer.email),
    recoveryLinkUrl: caseRecord.recoveryLinkUrl,
    createdAt: caseRecord.createdAt,
    timeline,
  });
}
