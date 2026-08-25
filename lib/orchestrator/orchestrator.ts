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
import { getMessageGenerator } from "@/lib/messaging";
import type { MessageGenerationInput } from "@/lib/messaging/types";
import { getChannelAdapter } from "@/lib/channels";
import { emitCaseTransition } from "@/lib/events/emit";
import {
  Actor,
  CaseState,
  Channel,
  DeliveryStatus,
  GeneratedBy,
  JobStatus,
  Language,
  Scenario,
  type Case,
  type DraftMessage,
} from "@prisma/client";
import { extractInvoiceNumber } from "@/lib/classification/rules";

/** Case shape carrying the relations `sendDraftAndTransition` needs. */
type CaseWithSendRelations = Case & {
  customer: { name: string; email: string; phone: string };
  merchant: { name: string };
  recoveryEvent: { scenario: Scenario };
  classifiedCase: { causeCode: string } | null;
};

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
// Graduated escalation (Phase 9) — INVOICE_OVERDUE only
// ---------------------------------------------------------------------------

/**
 * Days between `dueDate` and now, floored (0 = due today or in the
 * future). Returns null when there's no due date to compute from.
 */
export function getDaysOverdue(
  dueDate: Date | null,
  now: Date = new Date(),
): number | null {
  if (!dueDate) return null;
  const diffMs = now.getTime() - dueDate.getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Maps daysOverdue to the escalation tier used to look up the matching
 * RecoveryPolicy row (see the `escalationTier` doc comment on the model):
 *   Tier 1 — 1-3 days overdue  -> FRIENDLY_NUDGE
 *   Tier 2 — 4-10 days overdue -> FIRM_REMINDER
 *   Tier 3 — 11+ days overdue  -> ESCALATE_TO_HUMAN
 */
export function getEscalationTier(daysOverdue: number): 1 | 2 | 3 {
  if (daysOverdue <= 3) return 1;
  if (daysOverdue <= 10) return 2;
  return 3;
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

  // --- Guardrail: Human approval check (Phase 7) ---
  // Latest transition rules the day: if a human has already resolved this
  // case (approve/reject/reclassify), the orchestrator should not gate on
  // an older `pending_human_approval` transition again.
  const latestTransition = caseRecord.transitions[0];
  if (latestTransition?.reasonCode === "pending_human_approval") {
    return { action: "skipped", reason: "pending_human_approval" };
  }

  // --- Guardrail: Amount-over-threshold intercept (Phase 7) ---
  // Big-ticket cases don't get auto-sent; they wait for a human. Once a
  // reviewer approves (writes `human_approved`), the check above passes
  // because `latestTransition` becomes the approval, not the intercept.
  // Any historical `human_approved` transition means a reviewer already
  // green-lit this case — don't re-intercept on subsequent decideNextAction
  // ticks. Query directly rather than relying on the truncated `take: 5`
  // above so an approval that scrolled off is still respected.
  const alreadyApproved = (await prisma.caseTransition.count({
    where: { caseId, reasonCode: "human_approved" },
  })) > 0;
  if (
    !alreadyApproved &&
    caseRecord.recoveryEvent.amountPaise >=
      env.HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE
  ) {
    await prisma.$transaction(async (tx) => {
      await tx.caseTransition.create({
        data: {
          caseId,
          fromState: CaseState.DIAGNOSED,
          toState: CaseState.DIAGNOSED,
          actor: Actor.SYSTEM,
          reasonCode: "pending_human_approval",
          metadata: {
            amountPaise: caseRecord.recoveryEvent.amountPaise,
            threshold: env.HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE,
            trigger: "amount_over_threshold",
          },
        },
      });
      await tx.auditLog.create({
        data: {
          entityType: "Case",
          entityId: caseId,
          actor: Actor.SYSTEM,
          action: "pending_human_approval",
          reasonCode: "amount_over_threshold",
          afterState: {
            amountPaise: caseRecord.recoveryEvent.amountPaise,
            threshold: env.HUMAN_REVIEW_AMOUNT_THRESHOLD_PAISE,
          },
        },
      });
    });
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
  // INVOICE_OVERDUE resolves to one of three tiered policy rows sharing the
  // same (scenario, causeCode) — see getDaysOverdue/getEscalationTier
  // above and the `escalationTier` doc comment on RecoveryPolicy. Every
  // other scenario stores its policy with escalationTier: null, and the
  // case-side value below is also null for them, so this filter is a
  // no-op there — same lookup shape as before Phase 9.
  const escalationTier =
    caseRecord.recoveryEvent.scenario === Scenario.INVOICE_OVERDUE
      ? getEscalationTier(getDaysOverdue(caseRecord.recoveryEvent.dueDate) ?? 0)
      : null;

  const policy = await prisma.recoveryPolicy.findFirst({
    where: {
      scenario: caseRecord.recoveryEvent.scenario,
      causeCode,
      active: true,
      escalationTier,
    },
  });

  if (!policy) {
    await escalateCase(caseRecord, "no_policy_configured", causeCode);
    return { action: "escalated", reason: "no_policy_configured" };
  }

  // --- Guardrail: Max attempts ---
  const effectiveMaxAttempts = Math.min(
    caseRecord.maxAttempts,
    policy.maxAttempts,
  );
  if (caseRecord.attemptCount >= effectiveMaxAttempts) {
    await escalateCase(caseRecord, "max_attempts_exhausted", causeCode);
    return { action: "escalated", reason: "max_attempts_exhausted" };
  }

  // --- Guardrail: Cooldown ---
  const lastActionTransition = caseRecord.transitions.find(
    (t) =>
      t.reasonCode === "action_scheduled" ||
      t.reasonCode.startsWith("message_sent_"),
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
  // reasonCode is "message_sent_<channel>" (Phase 6) — match by prefix so
  // the cap applies across EMAIL/SMS/WHATSAPP uniformly.
  const recentContactCount = await prisma.caseTransition.count({
    where: {
      case: {
        customerId: caseRecord.customerId,
        id: { not: caseRecord.id }, // other cases only
      },
      reasonCode: { startsWith: "message_sent_" },
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

  // --- Tier 3 invoice escalation short-circuits straight to a human ---
  // ESCALATE_TO_HUMAN never drafts or sends a message — it exists purely
  // to move the case into the approval queue for an account manager.
  if (action === "ESCALATE_TO_HUMAN") {
    await escalateCase(caseRecord, "invoice_tier3_escalation", causeCode);
    return { action: "escalated", reason: "invoice_tier3_escalation" };
  }

  let recoveryLinkId: string | null = null;
  let recoveryLinkUrl: string | null = null;
  let isPlaceholder = false;

  {
    // Every remaining action needs a link as its message's call-to-action.
    // RE_AUTH_LINK (lapsed mandate) and UPDATE_PAYMENT_METHOD (expired
    // mandate card) reuse the same Payment Link creation call as
    // RETRY_LINK/REMINDER/FRIENDLY_NUDGE/FIRM_REMINDER — Razorpay doesn't
    // expose a dedicated "re-authorize this mandate" or "update this
    // card" API, so for this buildathon a Payment Link (whose template
    // copy explains the real ask — see templateGenerator.ts) stands in
    // for both. A real pilot would swap this for Razorpay's Subscription
    // update-payment-method flow once available.
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

    await emitCaseTransition(tx, {
      caseId,
      fromState: CaseState.DIAGNOSED,
      toState: CaseState.ACTION_SCHEDULED,
      causeCode,
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
 * Executes a scheduled recovery action for a case: generates the outreach
 * message, persists it as a `DraftMessage`, sends it through the channel
 * adapter, and transitions the case based on delivery outcome (see
 * `sendDraftAndTransition` below).
 */
export async function executeScheduledAction(
  payload: ScheduledActionPayload,
): Promise<void> {
  const { caseId, action, recoveryLinkUrl } = payload;

  const caseRecord = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    include: {
      customer: true,
      merchant: true,
      recoveryEvent: true,
      classifiedCase: true,
    },
  });

  // Guard: only act on ACTION_SCHEDULED cases.
  if (caseRecord.state !== CaseState.ACTION_SCHEDULED) {
    console.warn(
      `[orchestrator] executeScheduledAction called for case ${caseId} in ` +
        `state ${caseRecord.state} — expected ACTION_SCHEDULED, skipping.`,
    );
    return;
  }

  const linkUrl = caseRecord.recoveryLinkUrl ?? recoveryLinkUrl;
  if (!linkUrl) {
    // Guardrail: never draft a message with no recovery link to send.
    console.error(
      `[orchestrator] No recovery link available for case ${caseId} — ` +
        "skipping draft generation.",
    );
    await prisma.caseTransition.create({
      data: {
        caseId,
        fromState: CaseState.ACTION_SCHEDULED,
        toState: CaseState.ACTION_SCHEDULED,
        actor: Actor.SYSTEM,
        reasonCode: "draft_generation_failed_no_link",
      },
    });
    return;
  }

  const causeCode = caseRecord.classifiedCase?.causeCode ?? "UNCLASSIFIED";

  // Channel/language selection is hard-coded for the checkout drop-off
  // path built in Phases 1–8 — email is the primary channel (Brevo,
  // Phase 6) and templates are written in EN by default. Per-customer
  // channel/language preference is a natural Phase 8+ dashboard addition,
  // not a Phase 5 concern.
  const channel: MessageGenerationInput["channel"] = "EMAIL";
  const language: MessageGenerationInput["language"] = "EN";

  // INVOICE_OVERDUE-only facts (Phase 9) — the graduated-escalation
  // templates (FRIENDLY_NUDGE / FIRM_REMINDER) name the actual invoice
  // number and days overdue, never a placeholder. `action` also
  // disambiguates which tier's copy to render, since the causeCode alone
  // ("INVOICE_OVERDUE") is the same at every tier — see the composite
  // registry key in templateGenerator.ts.
  const isInvoice = caseRecord.recoveryEvent.scenario === Scenario.INVOICE_OVERDUE;
  const invoiceNumber = isInvoice
    ? (extractInvoiceNumber(caseRecord.recoveryEvent.rawPayload) ??
        `INV-${caseId.slice(-8).toUpperCase()}`)
    : undefined;
  const daysOverdue = isInvoice
    ? (getDaysOverdue(caseRecord.recoveryEvent.dueDate) ?? 0)
    : undefined;
  const dueDateLabel =
    isInvoice && caseRecord.recoveryEvent.dueDate
      ? caseRecord.recoveryEvent.dueDate.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : undefined;

  const generationInput: MessageGenerationInput = {
    caseId,
    causeCode,
    scenario: caseRecord.recoveryEvent.scenario,
    channel,
    language,
    customerName: caseRecord.customer.name,
    merchantName: caseRecord.merchant.name,
    amountPaise: caseRecord.recoveryEvent.amountPaise,
    currency: caseRecord.recoveryEvent.currency,
    recoveryLink: linkUrl,
    attemptNumber: caseRecord.attemptCount + 1,
    action,
    invoiceNumber,
    daysOverdue,
    dueDateLabel,
  };

  const result = await getMessageGenerator().generate(generationInput);

  // A fallback occurred if LLM drafting is enabled but the result came
  // back TEMPLATE-generated (llmGenerator falls back internally on error).
  const isFallback =
    env.USE_LLM_DRAFTING && result.generatedBy === GeneratedBy.TEMPLATE;

  const draft = await prisma.$transaction(async (tx) => {
    const draft = await tx.draftMessage.create({
      data: {
        caseId,
        channel: channel as Channel,
        language: language as Language,
        subject: result.subject,
        body: result.body,
        generatedBy: result.generatedBy as GeneratedBy,
        promptVersion: result.promptVersion,
      },
    });

    await tx.caseTransition.create({
      data: {
        caseId,
        fromState: CaseState.ACTION_SCHEDULED,
        toState: CaseState.ACTION_SCHEDULED,
        actor: Actor.SYSTEM,
        reasonCode: "draft_created",
        metadata: {
          draftMessageId: draft.id,
          channel,
          language,
          generatedBy: result.generatedBy,
          promptVersion: result.promptVersion ?? null,
          isFallback,
          action,
        },
      },
    });

    await tx.auditLog.create({
      data: {
        entityType: "DraftMessage",
        entityId: draft.id,
        actor: Actor.SYSTEM,
        action: "draft_created",
        reasonCode: "draft_created",
        beforeState: { state: CaseState.ACTION_SCHEDULED },
        afterState: {
          draftMessageId: draft.id,
          channel,
          language,
          generatedBy: result.generatedBy,
          isFallback,
        },
      },
    });

    return draft;
  });

  await sendDraftAndTransition(caseRecord as CaseWithSendRelations, draft, channel, action);
}

// ---------------------------------------------------------------------------
// sendDraftAndTransition — Phase 6: actually deliver the draft
// ---------------------------------------------------------------------------

/**
 * Sends a `DraftMessage` through the appropriate channel adapter, records a
 * `DeliveryAttempt`, and transitions the case based on the outcome:
 *
 *   - SENT   -> case moves to ACTION_SENT, attemptCount increments,
 *               CaseTransition `reasonCode: "message_sent_<channel>"`.
 *   - FAILED, attempts remaining -> case stays ACTION_SCHEDULED, a new
 *               ScheduledJob is created `cooldownMinutes` out (reuses the
 *               Phase 4 guardrail machinery on the next cycle),
 *               CaseTransition `reasonCode: "delivery_failed_will_retry"`.
 *   - FAILED, at max attempts -> case is escalated,
 *               CaseTransition `reasonCode: "delivery_failed_max_attempts"`.
 */
async function sendDraftAndTransition(
  caseRecord: CaseWithSendRelations,
  draft: DraftMessage,
  channel: Channel,
  action: string,
): Promise<void> {
  const adapter = getChannelAdapter(channel);

  const sendResult = await adapter.send({
    channel,
    to: {
      email: caseRecord.customer.email,
      phone: caseRecord.customer.phone,
      name: caseRecord.customer.name,
    },
    subject: draft.subject ?? undefined,
    body: draft.body,
    metadata: { caseId: caseRecord.id, merchantName: caseRecord.merchant.name },
  });

  const deliveryAttempt = await prisma.deliveryAttempt.create({
    data: {
      draftMessageId: draft.id,
      channel,
      status:
        sendResult.status === "SENT"
          ? DeliveryStatus.SENT
          : DeliveryStatus.FAILED,
      providerRef: sendResult.providerRef,
      errorDetail: sendResult.errorDetail,
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "DeliveryAttempt",
      entityId: deliveryAttempt.id,
      actor: Actor.SYSTEM,
      action: "delivery_attempted",
      reasonCode: sendResult.status === "SENT" ? "delivery_sent" : "delivery_failed",
      beforeState: { draftMessageId: draft.id, channel },
      afterState: {
        status: sendResult.status,
        providerRef: sendResult.providerRef ?? null,
        errorDetail: sendResult.errorDetail ?? null,
      },
    },
  });

  if (sendResult.status === "SENT") {
    await prisma.$transaction(async (tx) => {
      await tx.case.update({
        where: { id: caseRecord.id },
        data: {
          state: CaseState.ACTION_SENT,
          attemptCount: { increment: 1 },
        },
      });

      await tx.caseTransition.create({
        data: {
          caseId: caseRecord.id,
          fromState: CaseState.ACTION_SCHEDULED,
          toState: CaseState.ACTION_SENT,
          actor: Actor.SYSTEM,
          reasonCode: `message_sent_${channel.toLowerCase()}`,
          metadata: {
            draftMessageId: draft.id,
            deliveryAttemptId: deliveryAttempt.id,
            providerRef: sendResult.providerRef ?? null,
            channel,
          },
        },
      });

      await emitCaseTransition(tx, {
        caseId: caseRecord.id,
        fromState: CaseState.ACTION_SCHEDULED,
        toState: CaseState.ACTION_SENT,
        causeCode: caseRecord.classifiedCase?.causeCode ?? null,
      });
    });
    return;
  }

  // --- Delivery failed: retry (within attempt budget) or escalate. ---
  const policy = await prisma.recoveryPolicy.findFirst({
    where: {
      scenario: caseRecord.recoveryEvent.scenario,
      causeCode: caseRecord.classifiedCase?.causeCode ?? "",
      active: true,
    },
  });

  // Mirrors decideNextAction's effective-max-attempts guardrail — the more
  // restrictive of the case-level and policy-level caps wins. No policy on
  // this failure path (shouldn't normally happen, since decideNextAction
  // already required one to schedule the action) falls back to the case's
  // own cap so a delivery failure never retries forever.
  const effectiveMaxAttempts = policy
    ? Math.min(caseRecord.maxAttempts, policy.maxAttempts)
    : caseRecord.maxAttempts;

  if (caseRecord.attemptCount < effectiveMaxAttempts) {
    const cooldownMinutes = policy?.cooldownMinutes ?? 60;
    const runAt = new Date(Date.now() + cooldownMinutes * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      await tx.caseTransition.create({
        data: {
          caseId: caseRecord.id,
          fromState: CaseState.ACTION_SCHEDULED,
          toState: CaseState.ACTION_SCHEDULED,
          actor: Actor.SYSTEM,
          reasonCode: "delivery_failed_will_retry",
          metadata: {
            draftMessageId: draft.id,
            deliveryAttemptId: deliveryAttempt.id,
            errorDetail: sendResult.errorDetail ?? null,
            channel,
            runAt: runAt.toISOString(),
          },
        },
      });

      await tx.scheduledJob.create({
        data: {
          caseId: caseRecord.id,
          jobType: "execute_recovery_action",
          payload: {
            caseId: caseRecord.id,
            action,
            recoveryLinkUrl: caseRecord.recoveryLinkUrl ?? "",
          },
          runAt,
          status: JobStatus.PENDING,
        },
      });
    });
    return;
  }

  await escalateCase(
    caseRecord,
    "delivery_failed_max_attempts",
    caseRecord.classifiedCase?.causeCode ?? null,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function escalateCase(
  caseRecord: Case,
  reasonCode: string,
  causeCode: string | null = null,
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

    await emitCaseTransition(tx, {
      caseId: caseRecord.id,
      fromState: caseRecord.state,
      toState: CaseState.ESCALATED,
      causeCode,
    });
  });
}
