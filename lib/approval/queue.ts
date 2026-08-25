/**
 * Approval queue — computes "which cases need a human right now?" from
 * the state already in the database. No dedicated `NeedsApproval` table;
 * three orthogonal signals surface a case:
 *
 *   1. `below_threshold` — the latest CaseTransition has
 *      `reasonCode: "classification_below_threshold"` (from Phase 3).
 *   2. `amount_over_threshold` — the case is DIAGNOSED and the underlying
 *      RecoveryEvent.amountPaise >= `HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE`,
 *      AND we haven't already recorded a human approve/reject on it.
 *   3. `escalated` — the case is in `ESCALATED` state (max-attempts,
 *      no-policy, delivery-failed-max-attempts, etc.).
 *
 * Once a human resolves the case (approve/reject/reclassify/mark-recovered),
 * it drops out of the queue naturally — the underlying condition is either
 * cleared (state changes, latest transition is different) or superseded by
 * a HUMAN transition.
 */

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  Actor,
  CaseState,
  type Scenario,
} from "@prisma/client";

export type ApprovalReason =
  | "below_threshold"
  | "amount_over_threshold"
  | "escalated";

export interface ApprovalQueueItem {
  caseId: string;
  scenario: Scenario;
  state: CaseState;
  customerName: string;
  customerEmail: string;
  merchantName: string;
  amountPaise: number;
  currency: string;
  causeCode: string | null;
  confidence: number | null;
  reason: ApprovalReason;
  createdAt: Date;
  latestTransitionAt: Date;
}

export interface ApprovalFilters {
  scenario?: Scenario;
  reason?: ApprovalReason;
}

/**
 * Latest transition reason codes that mean "the human already made a
 * call on this case" — used to keep resolved cases from bouncing back
 * into the queue when the underlying condition (e.g. amount over
 * threshold) still holds.
 */
const HUMAN_RESOLUTION_REASONS = new Set([
  "human_approved",
  "human_rejected",
  "human_reclassified",
  "human_marked_recovered",
]);

/** Build a queue item from a loaded Case (with the relations we need). */
type LoadedCase = Awaited<ReturnType<typeof loadCandidateCases>>[number];

async function loadCandidateCases(where: object) {
  return prisma.case.findMany({
    where,
    include: {
      customer: { select: { name: true, email: true } },
      merchant: { select: { name: true } },
      recoveryEvent: {
        select: { amountPaise: true, currency: true, scenario: true },
      },
      classifiedCase: {
        select: { causeCode: true, confidence: true },
      },
      transitions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

function buildItem(
  c: LoadedCase,
  reason: ApprovalReason,
): ApprovalQueueItem {
  const latest = c.transitions[0];
  return {
    caseId: c.id,
    scenario: c.recoveryEvent.scenario,
    state: c.state,
    customerName: c.customer.name,
    customerEmail: c.customer.email,
    merchantName: c.merchant.name,
    amountPaise: c.recoveryEvent.amountPaise,
    currency: c.recoveryEvent.currency,
    causeCode: c.classifiedCase?.causeCode ?? null,
    confidence: c.classifiedCase?.confidence ?? null,
    reason,
    createdAt: c.createdAt,
    latestTransitionAt: latest?.createdAt ?? c.createdAt,
  };
}

export async function getApprovalQueue(
  filters: ApprovalFilters = {},
): Promise<ApprovalQueueItem[]> {
  const scenarioFilter = filters.scenario
    ? { recoveryEvent: { scenario: filters.scenario } }
    : {};

  const items: ApprovalQueueItem[] = [];
  const seen = new Set<string>();

  // 1. below_threshold — cases whose LATEST transition is
  //    classification_below_threshold.
  if (!filters.reason || filters.reason === "below_threshold") {
    const belowCandidates = await loadCandidateCases({
      state: { notIn: [CaseState.RECOVERED, CaseState.CLOSED] },
      ...scenarioFilter,
    });
    for (const c of belowCandidates) {
      const latest = c.transitions[0];
      if (latest?.reasonCode === "classification_below_threshold") {
        items.push(buildItem(c, "below_threshold"));
        seen.add(c.id);
      }
    }
  }

  // 2. amount_over_threshold — DIAGNOSED and pending human on amount.
  //    The orchestrator writes `pending_human_approval` when it intercepts
  //    an amount-over-threshold case; that transition is the strongest
  //    signal, but we also fall back to the amount check on any DIAGNOSED
  //    case in case the orchestrator hasn't run yet.
  if (!filters.reason || filters.reason === "amount_over_threshold") {
    const diagnosed = await loadCandidateCases({
      state: CaseState.DIAGNOSED,
      recoveryEvent: {
        amountPaise: { gte: env.HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE },
        ...(filters.scenario ? { scenario: filters.scenario } : {}),
      },
    });
    for (const c of diagnosed) {
      if (seen.has(c.id)) continue;
      const latest = c.transitions[0];
      // Skip cases a human already resolved.
      if (latest && HUMAN_RESOLUTION_REASONS.has(latest.reasonCode)) continue;
      items.push(buildItem(c, "amount_over_threshold"));
      seen.add(c.id);
    }
  }

  // 3. escalated — case is in ESCALATED state.
  if (!filters.reason || filters.reason === "escalated") {
    const escalated = await loadCandidateCases({
      state: CaseState.ESCALATED,
      ...scenarioFilter,
    });
    for (const c of escalated) {
      if (seen.has(c.id)) continue;
      const latest = c.transitions[0];
      if (latest && HUMAN_RESOLUTION_REASONS.has(latest.reasonCode)) continue;
      items.push(buildItem(c, "escalated"));
      seen.add(c.id);
    }
  }

  // Newest first — reviewers care about fresh queue items.
  items.sort(
    (a, b) => b.latestTransitionAt.getTime() - a.latestTransitionAt.getTime(),
  );
  return items;
}

/**
 * Convenience: check if a given case would appear in the queue right
 * now. Used by orchestrator + approval routes to guard actions.
 */
export async function isCaseAwaitingApproval(
  caseId: string,
): Promise<ApprovalReason | null> {
  const queue = await getApprovalQueue();
  return queue.find((i) => i.caseId === caseId)?.reason ?? null;
}

/** Exported for testability and re-use. */
export { HUMAN_RESOLUTION_REASONS };
export { Actor };
