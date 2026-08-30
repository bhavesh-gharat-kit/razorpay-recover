/**
 * Build a chronological timeline for a case by merging its AuditLog and
 * CaseTransition rows and attaching a human-readable `description` to
 * each entry. Consumed by both the JSON audit endpoint and the CSV
 * exporter, and by Phase 8's timeline UI.
 */

import { prisma } from "@/lib/db";
import type { Actor } from "@prisma/client";

export interface TimelineEntry {
  source: "AuditLog" | "CaseTransition";
  createdAt: Date;
  actor: Actor;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  reasonCode: string | null;
  description: string;
  beforeState: unknown;
  afterState: unknown;
  metadata: unknown;
  fromState: string | null;
  toState: string | null;
}

/** Human-readable labels for raw CaseTransition reason codes. */
const TRANSITION_LABELS: Record<string, string> = {
  classified_INSUFFICIENT_FUNDS: "Classified — Insufficient funds",
  classified_CARD_DECLINED: "Classified — Card declined",
  classified_BANK_DOWNTIME: "Classified — Bank downtime",
  classified_NETWORK_ERROR: "Classified — Network error",
  classified_UPI_TIMEOUT: "Classified — UPI timeout",
  classified_AUTHENTICATION_FAILED: "Classified — Authentication failed",
  classified_USER_CANCELLED: "Classified — User cancelled",
  classified_MANDATE_INSUFFICIENT_FUNDS: "Classified — Mandate insufficient funds",
  classified_MANDATE_EXPIRED: "Classified — Mandate expired",
  classified_MANDATE_CANCELLED: "Classified — Mandate cancelled",
  classified_INVOICE_OVERDUE: "Classified — Invoice overdue",
  classified_INVOICE_DISPUTED: "Classified — Invoice disputed",
  pending_human_approval: "Held for human approval",
  human_approved: "Approved by reviewer",
  human_rejected: "Rejected by reviewer",
  case_rejected: "Rejected — case closed",
  case_approved: "Approved — orchestrator will resume",
  case_marked_recovered: "Marked as recovered",
  action_scheduled: "Recovery action scheduled",
  message_sent_email: "Message sent via email",
  message_sent_sms: "Message sent via SMS",
  message_sent_whatsapp: "Message sent via WhatsApp",
  message_failed_email: "Email delivery failed",
  message_failed_sms: "SMS delivery failed",
  message_failed_whatsapp: "WhatsApp delivery failed",
  auto_recovered: "Auto-recovered via payment link",
  case_escalated: "Escalated to human review",
  draft_created: "Draft message generated",
  delivery_attempted: "Delivery attempted",
  payment_link_created: "Payment link created",
  payment_link_creation_failed: "Payment link creation failed",
  event_ingested: "Recovery event ingested",
};

/** Human-readable labels for CaseState enum values. */
const STATE_LABELS: Record<string, string> = {
  DETECTED: "Detected",
  DIAGNOSED: "Diagnosed",
  ACTION_SCHEDULED: "Action Scheduled",
  ACTION_SENT: "Action Sent",
  RECOVERED: "Recovered",
  ESCALATED: "Escalated",
  ABANDONED: "Abandoned",
  CLOSED: "Closed",
};

/** Human-readable labels for AuditLog action values not handled by
 * the switch-case in describe(). */
const ACTION_LABELS: Record<string, string> = {
  payment_link_created: "Payment link created",
  payment_link_creation_failed: "Payment link creation failed",
};

/**
 * Compose a friendly one-liner for an entry. Falls back to the raw
 * action/reasonCode when we don't have a nicer template for it — better
 * to be verbose than to hide a real event from the reviewer.
 */
export function describe(entry: {
  source: "AuditLog" | "CaseTransition";
  action: string;
  reasonCode: string | null;
  fromState?: string | null;
  toState?: string | null;
  metadata?: unknown;
  beforeState?: unknown;
  afterState?: unknown;
}): string {
  const md = (entry.metadata ?? {}) as Record<string, unknown>;
  const after = (entry.afterState ?? {}) as Record<string, unknown>;

  // Classification decisions carry a confidence in metadata/afterState.
  const confidence =
    typeof md.confidence === "number"
      ? md.confidence
      : typeof after.confidence === "number"
        ? after.confidence
        : null;
  const cause =
    typeof md.causeCode === "string"
      ? md.causeCode
      : typeof after.causeCode === "string"
        ? after.causeCode
        : null;
  const source =
    typeof md.source === "string"
      ? md.source
      : typeof after.source === "string"
        ? (after.source as string)
        : null;

  switch (entry.action) {
    case "event_ingested":
      return "Recovery event ingested (case opened).";
    case "classification_succeeded":
      return `Classified as ${cause ?? "UNKNOWN"} by ${source === "RULE" ? "rule engine" : "embedding classifier"}${confidence != null ? ` (confidence: ${confidence.toFixed(2)})` : ""}.`;
    case "classification_below_threshold":
      return `Classification below confidence threshold — sent to human review${cause ? ` (best guess: ${cause})` : ""}.`;
    case "action_scheduled": {
      const linkId = typeof after.recoveryLinkId === "string" ? after.recoveryLinkId : null;
      const actionName = typeof after.action === "string" ? after.action : "action";
      return `Orchestrator scheduled ${actionName}${linkId ? ` with Payment Link ${linkId}` : ""}.`;
    }
    case "pending_human_approval":
      return `Held for human approval (reason: ${entry.reasonCode ?? "unspecified"}).`;
    case "case_approved":
      return "Approved by reviewer — orchestrator will resume on next tick.";
    case "case_rejected":
      return "Rejected by reviewer — case closed.";
    case "case_reclassified": {
      const before = (entry.beforeState ?? {}) as Record<string, unknown>;
      const newCause = typeof after.causeCode === "string" ? after.causeCode : "?";
      const oldCause = typeof before.causeCode === "string" ? (before.causeCode as string) : "?";
      return `Reviewer reclassified: ${oldCause} → ${newCause}.`;
    }
    case "case_marked_recovered": {
      const amt = typeof after.recoveredAmountPaise === "number" ? after.recoveredAmountPaise : null;
      return `Reviewer marked case recovered${amt ? ` (₹${(amt / 100).toFixed(2)})` : ""}.`;
    }
    case "draft_created": {
      const gen = typeof after.generatedBy === "string" ? after.generatedBy : "TEMPLATE";
      const ch = typeof after.channel === "string" ? after.channel : "";
      return `Draft message generated (${gen}${ch ? `, ${ch}` : ""}).`;
    }
    case "draft_edited":
      return "Draft message edited by reviewer.";
    case "delivery_attempted": {
      const status = typeof after.status === "string" ? after.status : "?";
      const ref = typeof after.providerRef === "string" ? after.providerRef : null;
      const err = typeof after.errorDetail === "string" ? after.errorDetail : null;
      if (status === "SENT") {
        return `Message delivered${ref ? ` (providerRef: ${ref})` : ""}.`;
      }
      return `Delivery failed${err ? `: ${err}` : ""}.`;
    }
    case "auto_recovered": {
      const amt = typeof after.recoveredAmountPaise === "number" ? after.recoveredAmountPaise : null;
      return `Auto-recovered via Payment Link${amt ? ` (₹${(amt / 100).toFixed(2)})` : ""}.`;
    }
    case "case_escalated":
      return `Escalated (${entry.reasonCode ?? "reason not recorded"}).`;
    case "retry_send_requested":
      return "Reviewer requested a retry send — a new send is queued for the next tick.";
    case "promise_to_pay_logged": {
      const dateStr = typeof after.promisedPaymentDate === "string" ? after.promisedPaymentDate : null;
      return `Promise to pay logged${dateStr ? ` — expected by ${new Date(dateStr).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}. Escalation paused until then.`;
    }
    case "login_succeeded":
      return "User signed in.";
    case "login_failed":
      return `Login failed (${entry.reasonCode ?? "reason not recorded"}).`;
    case "logout":
      return "User signed out.";
  }

  // Fallback for transitions with no matching audit action.
  if (entry.source === "CaseTransition") {
    const label = entry.reasonCode ? TRANSITION_LABELS[entry.reasonCode] : null;
    if (label) return label;
    if (entry.fromState && entry.toState && entry.fromState !== entry.toState) {
      const from = STATE_LABELS[entry.fromState] ?? entry.fromState;
      const to = STATE_LABELS[entry.toState] ?? entry.toState;
      return `State changed: ${from} → ${to}`;
    }
    return entry.reasonCode ? (TRANSITION_LABELS[entry.reasonCode] ?? entry.reasonCode) : "Case transition";
  }

  return ACTION_LABELS[entry.action] ?? entry.action;
}

/**
 * Determine if two timeline entries describe the same real event — e.g.
 * a CaseTransition with reasonCode `classified_INSUFFICIENT_FUNDS` and
 * an AuditLog with action `classification_succeeded`.
 */
function sameActionFamily(a: TimelineEntry, b: TimelineEntry): boolean {
  const actions = [a.action, b.action, a.reasonCode, b.reasonCode].filter(Boolean);
  const normalized = actions.map((s) => (s ?? "").toLowerCase());

  // Direct match on action or reasonCode
  if (a.action === b.action || a.action === b.reasonCode || a.reasonCode === b.action) {
    return true;
  }

  // Classification events: CaseTransition `classified_*` ↔ AuditLog `classification_*`
  if (normalized.some((s) => s.startsWith("classified_")) && normalized.some((s) => s.startsWith("classification_"))) {
    return true;
  }

  // Message events: CaseTransition `message_sent_*` ↔ AuditLog `delivery_attempted`
  if (normalized.some((s) => s.startsWith("message_sent_") || s.startsWith("message_failed_")) && normalized.some((s) => s === "delivery_attempted")) {
    return true;
  }

  // Action-scheduled events
  if (normalized.some((s) => s === "action_scheduled") && normalized.some((s) => s === "action_scheduled")) {
    return true;
  }

  // Human review events
  if (normalized.some((s) => s === "pending_human_approval") && normalized.some((s) => s === "pending_human_approval")) {
    return true;
  }

  return false;
}

export async function buildCaseTimeline(caseId: string): Promise<TimelineEntry[]> {
  // Load both streams in parallel.
  const [auditRows, transitionRows] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: "Case", entityId: caseId },
      include: { actorUser: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.caseTransition.findMany({
      where: { caseId },
      include: { actorUser: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // Also include DraftMessage / DeliveryAttempt audit rows tied to this
  // case (they're keyed by DraftMessage.id / DeliveryAttempt.id, so we
  // need to look them up first).
  const drafts = await prisma.draftMessage.findMany({
    where: { caseId },
    select: { id: true, deliveryAttempts: { select: { id: true } } },
  });
  const draftIds = drafts.map((d) => d.id);
  const attemptIds = drafts.flatMap((d) => d.deliveryAttempts.map((a) => a.id));

  const relatedAudit = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityType: "DraftMessage", entityId: { in: draftIds } },
        { entityType: "DeliveryAttempt", entityId: { in: attemptIds } },
      ],
    },
    include: { actorUser: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const entries: TimelineEntry[] = [];

  for (const row of [...auditRows, ...relatedAudit]) {
    entries.push({
      source: "AuditLog",
      createdAt: row.createdAt,
      actor: row.actor,
      actorUserId: row.actorUserId,
      actorEmail: row.actorUser?.email ?? null,
      action: row.action,
      reasonCode: row.reasonCode,
      description: describe({
        source: "AuditLog",
        action: row.action,
        reasonCode: row.reasonCode,
        beforeState: row.beforeState,
        afterState: row.afterState,
      }),
      beforeState: row.beforeState,
      afterState: row.afterState,
      metadata: null,
      fromState: null,
      toState: null,
    });
  }

  for (const t of transitionRows) {
    entries.push({
      source: "CaseTransition",
      createdAt: t.createdAt,
      actor: t.actor,
      actorUserId: t.actorUserId,
      actorEmail: t.actorUser?.email ?? null,
      action: t.reasonCode,
      reasonCode: t.reasonCode,
      description: describe({
        source: "CaseTransition",
        action: t.reasonCode,
        reasonCode: t.reasonCode,
        fromState: t.fromState,
        toState: t.toState,
        metadata: t.metadata,
      }),
      beforeState: null,
      afterState: null,
      metadata: t.metadata,
      fromState: t.fromState,
      toState: t.toState,
    });
  }

  entries.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Deduplicate entries that describe the same real event — an AuditLog
  // and CaseTransition row often fire within ~500 ms for the same action.
  // Keep the AuditLog version (richer description) and drop the matching
  // CaseTransition if it's within 2 s and shares the action family.
  const deduped: TimelineEntry[] = [];
  for (const entry of entries) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.source !== entry.source &&
      Math.abs(entry.createdAt.getTime() - prev.createdAt.getTime()) < 2000 &&
      sameActionFamily(prev, entry)
    ) {
      // Keep the AuditLog version; drop the duplicate.
      if (entry.source === "AuditLog") {
        deduped[deduped.length - 1] = entry;
      }
      continue;
    }
    deduped.push(entry);
  }

  return deduped;
}
