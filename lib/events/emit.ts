/**
 * SystemEvent writer — the cross-process signal Phase 8's SSE endpoint
 * polls for. Any code path that changes a Case's state, or finishes a
 * batch of work, or auto-recovers money, writes a row here so the
 * dashboard can react in near-real-time without the browser polling the
 * full case/analytics endpoints every couple of seconds.
 *
 * Accepts either the shared Prisma singleton or a `$transaction` client,
 * since most callers write the event inside the same transaction as the
 * state change it describes (atomic: no event survives if the change it
 * reports on gets rolled back). The worker process uses its own
 * `PrismaClient` instance (separate OS process) — both point at the same
 * MySQL database, so a plain client works there too.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

type EventWriter = PrismaClient | Prisma.TransactionClient;

export interface CaseTransitionEventPayload {
  caseId: string;
  fromState: string | null;
  toState: string;
  causeCode: string | null;
}

export interface BatchSummaryEventPayload {
  processed: number;
  classified: number;
  scheduled: number;
  sent: number;
  recovered: number;
}

export interface RecoveryDetectedEventPayload {
  caseId: string;
  amountPaise: number;
}

/** Write a `case_transition` row — call whenever `Case.state` actually changes. */
export async function emitCaseTransition(
  db: EventWriter,
  payload: CaseTransitionEventPayload,
): Promise<void> {
  await db.systemEvent.create({
    data: { eventType: "case_transition", payload: payload as unknown as Prisma.InputJsonValue },
  });
}

/** Write a `batch_summary` row — call once at the end of a worker/tick run. */
export async function emitBatchSummary(
  db: EventWriter,
  payload: BatchSummaryEventPayload,
): Promise<void> {
  await db.systemEvent.create({
    data: { eventType: "batch_summary", payload: payload as unknown as Prisma.InputJsonValue },
  });
}

/** Write a `recovery_detected` row — call when the payment_link.paid auto-recovery loop fires. */
export async function emitRecoveryDetected(
  db: EventWriter,
  payload: RecoveryDetectedEventPayload,
): Promise<void> {
  await db.systemEvent.create({
    data: { eventType: "recovery_detected", payload: payload as unknown as Prisma.InputJsonValue },
  });
}
