/**
 * Recovery Orchestrator — the ONLY module allowed to trigger a recovery action.
 *
 * Enforces every safety guardrail:
 *   - Policy lookup (no policy → escalate)
 *   - Max attempts (exhausted → escalate)
 *   - Cooldown (too soon → skip)
 *   - Per-customer contact cap (over limit → skip with reason)
 *   - Human approval check (pending → skip)
 *   - Promise-to-pay check (future date → skip)
 *   - Smart send timing (outside window → delay runAt)
 *
 * After guardrails pass: creates a Razorpay Payment Link, transitions the
 * Case to ACTION_SCHEDULED, and inserts a ScheduledJob row.
 */

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createPaymentLink } from "@/lib/razorpay/client";
import {
  Actor,
  CaseState,
  JobStatus,
  type Case,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecideResult {
  action: "scheduled" | "skipped" | "escalated";
  reason: string;
  runAt?: Date;
}

export interface ScheduledActionPayload {
  caseId: string;
  action: string;
  recoveryLinkUrl: string | null;
}

// ---------------------------------------------------------------------------
// IST time helpers
// ---------------------------------------------------------------------------

/** IST is UTC+5:30 (330 minutes). */
const IST_OFFSET_MINUTES = 330;

/** Get the current hour in IST (0–23). */
function currentISTHour(): number {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + IST_OFFSET_MINUTES) % (24 * 60);
  return Math.floor(istMinutes / 60);
}

/**
 * Calculate a `runAt` time that falls within the send window.
 * If we're currently inside the window, returns `now`.
 * If we're outside, returns the next opening of the window.
 */
export function computeRunAt(
  sendWindowStartHour: number,
  sendWindowEndHour: number,
  now: Date = new Date(),
): Date {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + IST_OFFSET_MINUTES) % (24 * 60);
  const istHour = Math.floor(istMinutes / 60);

  if (istHour >= sendWindowStartHour && istHour < sendWindowEndHour) {
    // Inside window — schedule immediately.
    return now;
  }

  // Outside window — compute next opening.
  // If we're past the window end today, the next window is tomorrow.
  // If we're before the window start today, it opens later today.
  let hoursUntilOpen: number;
  if (istHour >= sendWindowEndHour) {
    // Past end → next opening is tomorrow at sendWindowStartHour
    hoursUntilOpen = 24 - istHour + sendWindowStartHour;
  } else {
    // Before start → opens later today
    hoursUntilOpen = sendWindowStartHour - istHour;
  }

  // Subtract the fractional hour we're into the current hour for precision.
  const currentMinuteOfHour = istMinutes % 60;
  const minutesUntilOpen = hoursUntilOpen * 60 - currentMinuteOfHour;

  return new Date(now.getTime() + minutesUntilOpen * 60 * 1000);
}

// ---------------------------------------------------------------------------
// decideNextAction — the core guardrail + scheduling function
// ---------------------------------------------------------------------------

export async function decideNextAction(caseId: string): Promise<DecideResult> {
  // Load case with all related data.
  const caseRecord = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      classifiedCase: true,
      recoveryEvent: true,
      customer: true,
      transitions: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  // Only operate on DIAGNOSED cases.
  if (caseRecord.state !== CaseState.DIAGNOSED) {
    return { action: "skipped", reason: `case_state_is_${caseRecord.state}` };
  }

  const causeCode = caseRecord.classifiedCase?.causeCode;
  if (!causeCode) {
    return { action: "skipped", reason: "no_classified_case" };
  }

  // --- Guardrail: Human approval check (pre-wired for Phase 7) ---
  const latestTransition = caseRecord.transitions[0];
  if (latestTransition?.reasonCode === "pending_human_approval") {
    return { action: "skipped", reason: "pending_human_approval" };
  }

  // --- Guardrail: Promise-to-pay check (pre-wired for Phase 9) ---
  if (
    caseRecord.promisedPaymentDate &&
    caseRecord.promisedPaymentDate > new Date()
  ) {
    return { action: "skipped", reason: "promise_to_pay_active" };
  }

  // --- Guardrail: Policy lookup ---
  const policy = await prisma.recoveryPolicy.findFirst({
    where: {
      scenario: caseRecord.recoveryEvent.scenario,
      causeCode,
      active: true,
    },
  });

  if (!policy) {
    await escalateCase(caseRecord, "no_policy_configured");
    return { action: "escalated", reason: "no_policy_configured" };
  }

  // --- Guardrail: Max attempts ---
  const effectiveMaxAttempts = Math.min(
    caseRecord.maxAttempts,
    policy.maxAttempts,
  );
  if (caseRecord.attemptCount >= effectiveMaxAttempts) {
    await escalateCase(caseRecord, "max_attempts_exhausted");
    return { action: "escalated", reason: "max_attempts_exhausted" };
  }

  // --- Guardrail: Cooldown ---
  const lastActionTransition = caseRecord.transitions.find(
    (t) =>
      t.reasonCode === "action_scheduled" || t.reasonCode === "action_sent",
  );
  if (lastActionTransition) {
    const elapsedMs =
      Date.now() - lastActionTransition.createdAt.getTime();
    const elapsedMinutes = elapsedMs / (1000 * 60);
    if (elapsedMinutes < policy.cooldownMinutes) {
      return { action: "skipped", reason: "cooldown_active" };
    }
  }

  // --- Guardrail: Per-customer contact cap ---
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentContactCount = await prisma.caseTransition.count({
    where: {
      case: {
        customerId: caseRecord.customerId,
        id: { not: caseRecord.id }, // other cases only
      },
      reasonCode: "action_sent",
      createdAt: { gte: twentyFourHoursAgo },
    },
  });

  if (recentContactCount >= env.MAX_CONTACTS_PER_CUSTOMER_PER_DAY) {
    // Don't escalate — just wait and log.
    await prisma.caseTransition.create({
      data: {
        caseId,
        fromState: CaseState.DIAGNOSED,
        toState: CaseState.DIAGNOSED,
        actor: Actor.SYSTEM,
        reasonCode: "contact_cap_reached",
        metadata: {
          recentContacts: recentContactCount,
          cap: env.MAX_CONTACTS_PER_CUSTOMER_PER_DAY,
        },
      },
    });
    return { action: "skipped", reason: "contact_cap_reached" };
  }

  // --- Guardrail: Smart send timing ---
  const runAt = computeRunAt(
    policy.sendWindowStartHour,
    policy.sendWindowEndHour,
  );
  const isDelayed = runAt.getTime() > Date.now() + 60_000; // >1min in future

  // --- All guardrails passed → create recovery link + schedule action ---
  const allowedActions = policy.allowedActions as string[];
  // Pick the first action (future: smarter action selection based on
  // attempt number, customer preference, channel availability, etc.)
  const action = allowedActions[0] ?? "RETRY_LINK";

  let recoveryLinkId: string | null = null;
  let recoveryLinkUrl: string | null = null;
  let isPlaceholder = false;

  if (action === "RETRY_LINK" || action === "REMINDER") {
    const linkResult = await createPaymentLink({
      amountPaise: caseRecord.recoveryEvent.amountPaise,
      currency: caseRecord.recoveryEvent.currency,
      description: `Recovery for case ${caseId}`,
      customerName: caseRecord.customer.name,
      customerEmail: caseRecord.customer.email,
      customerPhone: caseRecord.customer.phone,
      expireBy: Math.floor(Date.now() / 1000) + 72 * 60 * 60, // 72 hours
      referenceId: caseId,
    });

    if (!linkResult.ok) {
      // Payment Link creation failed — log and skip, retry next tick.
      console.error(
        `[orchestrator] Payment Link creation failed for case ${caseId}:`,
        linkResult.error,
      );
      await prisma.caseTransition.create({
        data: {
          caseId,
          fromState: CaseState.DIAGNOSED,
          toState: CaseState.DIAGNOSED,
          actor: Actor.SYSTEM,
          reasonCode: "payment_link_creation_failed",
          metadata: { error: linkResult.error },
        },
      });
      return { action: "skipped", reason: "payment_link_creation_failed" };
    }

    recoveryLinkId = linkResult.id;
    recoveryLinkUrl = linkResult.shortUrl;
    isPlaceholder = linkResult.isPlaceholder;
  }

  // Persist everything in a transaction.
  await prisma.$transaction(async (tx) => {
    // Update case with recovery link info + transition to ACTION_SCHEDULED.
    // NOTE: attemptCount is NOT incremented here — that happens when the
    // action is actually SENT (executeScheduledAction), not when scheduled.
    await tx.case.update({
      where: { id: caseId },
      data: {
        state: CaseState.ACTION_SCHEDULED,
        recoveryLinkId,
        recoveryLinkUrl,
      },
    });

    // CaseTransition
    const metadata: Record<string, string | number | boolean | null> = {
      action,
      recoveryLinkId,
      recoveryLinkUrl,
      isPlaceholder,
      runAt: runAt.toISOString(),
    };
    if (isDelayed) {
      metadata.delayReason = "scheduled_for_send_window";
      metadata.sendWindowStartHour = policy.sendWindowStartHour;
      metadata.sendWindowEndHour = policy.sendWindowEndHour;
      metadata.currentISTHour = currentISTHour();
    }

    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: CaseState.DIAGNOSED,
        toState: CaseState.ACTION_SCHEDULED,
        actor: Actor.SYSTEM,
        reasonCode: isDelayed
          ? "scheduled_for_send_window"
          : "action_scheduled",
        metadata: metadata as Record<string, string | number | boolean>,
      },
    });

    // ScheduledJob
    await tx.scheduledJob.create({
      data: {
        caseId,
        jobType: "execute_recovery_action",
        payload: {
          caseId,
          action,
          recoveryLinkUrl: recoveryLinkUrl ?? "",
        },
        runAt,
        status: JobStatus.PENDING,
      },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.SYSTEM,
        action: "action_scheduled",
        reasonCode: isDelayed
          ? "scheduled_for_send_window"
          : "action_scheduled",
        beforeState: { state: CaseState.DIAGNOSED },
        afterState: {
          state: CaseState.ACTION_SCHEDULED,
          action,
          recoveryLinkId,
          recoveryLinkUrl,
          runAt: runAt.toISOString(),
          isPlaceholder,
        },
      },
    });
  });

  return {
    action: "scheduled",
    reason: isDelayed ? "scheduled_for_send_window" : "action_scheduled",
    runAt,
  };
}

// ---------------------------------------------------------------------------
// executeScheduledAction — called by the worker when a job comes due
// ---------------------------------------------------------------------------

/**
 * Executes a scheduled recovery action for a case.
 *
 * For Phase 4 this is a stub that logs "would send message here" and
 * transitions the case to ACTION_SENT + increments attemptCount. Phase 5/6
 * will replace the stub body with real message generation + channel sending.
 * The function signature and boundary are kept clean so swapping is a small
 * diff.
 */
export async function executeScheduledAction(
  payload: ScheduledActionPayload,
): Promise<void> {
  const { caseId, action, recoveryLinkUrl } = payload;

  const caseRecord = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    include: { customer: true, recoveryEvent: true },
  });

  // Guard: only act on ACTION_SCHEDULED cases.
  if (caseRecord.state !== CaseState.ACTION_SCHEDULED) {
    console.warn(
      `[orchestrator] executeScheduledAction called for case ${caseId} in ` +
        `state ${caseRecord.state} — expected ACTION_SCHEDULED, skipping.`,
    );
    return;
  }

  // --- STUB: Phase 5/6 will replace this block with real calls to ---
  // --- message generation + channel adapter pipeline.             ---
  console.log(
    `[orchestrator] STUB: would send ${action} message to ` +
      `${caseRecord.customer.email} for case ${caseId} ` +
      `(link: ${recoveryLinkUrl ?? "none"})`,
  );
  // --- END STUB ---

  // Transition to ACTION_SENT and increment attemptCount.
  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        state: CaseState.ACTION_SENT,
        attemptCount: { increment: 1 },
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: CaseState.ACTION_SCHEDULED,
        toState: CaseState.ACTION_SENT,
        actor: Actor.SYSTEM,
        reasonCode: "action_sent",
        metadata: {
          action,
          recoveryLinkUrl,
          stub: true, // Remove when real sending is wired in Phase 5/6.
        },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseId,
        actor: Actor.SYSTEM,
        action: "action_sent",
        reasonCode: "action_sent",
        beforeState: { state: CaseState.ACTION_SCHEDULED },
        afterState: {
          state: CaseState.ACTION_SENT,
          attemptCount: caseRecord.attemptCount + 1,
          action,
          recoveryLinkUrl,
          stub: true,
        },
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function escalateCase(
  caseRecord: Case,
  reasonCode: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseRecord.id },
      data: { state: CaseState.ESCALATED },
    });

    await tx.caseTransition.create({
      data: {
        caseId: caseRecord.id,
        fromState: caseRecord.state,
        toState: CaseState.ESCALATED,
        actor: Actor.SYSTEM,
        reasonCode,
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "Case",
        entityId: caseRecord.id,
        actor: Actor.SYSTEM,
        action: "case_escalated",
        reasonCode,
        beforeState: { state: caseRecord.state },
        afterState: { state: CaseState.ESCALATED },
      },
    });
  });
}
