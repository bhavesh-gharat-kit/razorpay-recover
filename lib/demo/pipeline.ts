/**
 * Synchronous end-to-end pipeline driver used by the live /demo flow.
 *
 * The production worker runs classify → decide → execute on its own cron
 * ticks, respecting the send-window on `ScheduledJob.runAt`. That's the
 * right default for real recovery cadence, but it makes a live demo dull —
 * a judge would submit a failed payment and then wait for the next cron
 * tick (and possibly for the send window to open) before seeing anything
 * happen.
 *
 * This helper runs the same three steps inline the moment `/api/demo/result`
 * ingests a failed/abandoned event, and — for a demo run only — bypasses
 * the `runAt` gate on the ScheduledJob the orchestrator created, executing
 * the send immediately. It writes ordinary CaseTransition / AuditLog /
 * DeliveryAttempt rows the same way the worker would, so the audit
 * timeline the demo UI polls tells the exact same story.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { classifyRecoveryEvent } from "@/lib/classification/classify";
import {
  decideNextAction,
  executeScheduledAction,
  type ScheduledActionPayload,
} from "@/lib/orchestrator/orchestrator";
import { JobStatus } from "@prisma/client";

export interface DemoPipelineResult {
  caseId: string;
  finalState: string;
  steps: string[];
}

export async function runDemoPipeline(
  caseId: string,
): Promise<DemoPipelineResult> {
  const steps: string[] = [];

  const caseRecord = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { id: true, recoveryEventId: true, state: true },
  });

  // --- 1. Classify -------------------------------------------------------
  try {
    const classifyResult = await classifyRecoveryEvent(
      caseRecord.recoveryEventId,
    );
    steps.push(
      `classified:${classifyResult.causeCode}:${classifyResult.confidence.toFixed(2)}`,
    );
  } catch (err) {
    logger.error({ err, caseId }, "demo pipeline: classification threw");
    steps.push("classify_failed");
  }

  // --- 2. Decide next action --------------------------------------------
  try {
    const decideResult = await decideNextAction(caseId);
    steps.push(`decide:${decideResult.action}:${decideResult.reason}`);
  } catch (err) {
    logger.error({ err, caseId }, "demo pipeline: decideNextAction threw");
    steps.push("decide_failed");
  }

  // --- 3. Execute any scheduled job now, bypassing runAt ----------------
  // The orchestrator may have deferred `runAt` into the send window
  // (or set it to `now` if inside). For a demo, we ignore the runAt
  // gate and execute immediately — this is the only place in the
  // codebase that does so, keeping the real orchestrator's timing
  // guarantees intact.
  const pendingJob = await prisma.scheduledJob.findFirst({
    where: {
      caseId,
      jobType: "execute_recovery_action",
      status: JobStatus.PENDING,
    },
    orderBy: { createdAt: "desc" },
  });

  if (pendingJob) {
    try {
      await prisma.scheduledJob.update({
        where: { id: pendingJob.id },
        data: { status: JobStatus.PROCESSING, lockedAt: new Date() },
      });

      await executeScheduledAction(
        pendingJob.payload as unknown as ScheduledActionPayload,
      );

      await prisma.scheduledJob.update({
        where: { id: pendingJob.id },
        data: { status: JobStatus.DONE, lockedAt: null },
      });
      steps.push("executed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, caseId, jobId: pendingJob.id },
        "demo pipeline: executeScheduledAction threw",
      );
      await prisma.scheduledJob.update({
        where: { id: pendingJob.id },
        data: {
          status: JobStatus.FAILED,
          lastError: message,
          lockedAt: null,
        },
      });
      steps.push("execute_failed");
    }
  } else {
    steps.push("no_pending_job");
  }

  const after = await prisma.case.findUniqueOrThrow({
    where: { id: caseId },
    select: { state: true },
  });

  return { caseId, finalState: after.state, steps };
}
