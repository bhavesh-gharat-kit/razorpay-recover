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
    if (entry.fromState && entry.toState && entry.fromState !== entry.toState) {
      return `${entry.reasonCode ?? "transition"}: ${entry.fromState} → ${entry.toState}`;
    }
    return entry.reasonCode ?? "case transition";
  }

  return entry.action;
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
  return entries;
}
