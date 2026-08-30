/**
 * /api/internal/run-orchestrator-tick
 *
 * Runs one worker-tick's worth of work: recover stale jobs, execute due
 * ScheduledJobs, then run the detect → classify → decide pipeline.
 *
 * Auth:
 *   - POST — an ADMIN session (the dashboard "Run Batch" button) OR the
 *     cron secret (`Authorization: Bearer <CRON_SECRET>`).
 *   - GET  — the cron secret only. This is the entry point for Vercel Cron
 *     (which issues GET requests) and other external schedulers, since on
 *     a serverless deploy there is no standalone worker process.
 *
 * `maxDuration` is raised because a backlog tick can take longer than the
 * platform default; the job/case scans are still capped per tick so it
 * stays bounded.
 */

import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { successResponse, errorResponse } from "@/lib/api/response";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { classifyRecoveryEvent } from "@/lib/classification/classify";
import { detectAbandonedCheckouts } from "@/lib/ingestion/detect-abandonment";
import {
  decideNextAction,
  executeScheduledAction,
} from "@/lib/orchestrator/orchestrator";
import type { ScheduledActionPayload } from "@/lib/orchestrator/orchestrator";
import { CaseState, JobStatus, UserRole } from "@prisma/client";
import { requireRole } from "@/lib/auth/requireRole";
import { isAuthorizedCron } from "@/lib/auth/cronAuth";
import { emitBatchSummary } from "@/lib/events/emit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface TickResults {
  staleRecovered: number;
  jobsClaimed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  abandonmentDetected: number;
  classified: number;
  scheduled: number;
  skipped: number;
  escalated: number;
}

async function runOrchestratorTick(): Promise<TickResults> {
  const tickStartedAt = new Date();

  const results: TickResults = {
    staleRecovered: 0,
    jobsClaimed: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    abandonmentDetected: 0,
    classified: 0,
    scheduled: 0,
    skipped: 0,
    escalated: 0,
  };

  // 1. Recover stale jobs.
  const staleResult = await prisma.scheduledJob.updateMany({
    where: {
      status: JobStatus.PROCESSING,
      lockedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
    },
    data: {
      status: JobStatus.PENDING,
      lockedAt: null,
      lastError: "stale_lock_reset_via_tick",
    },
  });
  results.staleRecovered = staleResult.count;

  // 2. Claim and execute due jobs.
  const dueJobs = await prisma.scheduledJob.findMany({
    where: {
      status: JobStatus.PENDING,
      runAt: { lte: new Date() },
    },
    orderBy: { runAt: "asc" },
    take: 20,
  });

  for (const job of dueJobs) {
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { status: JobStatus.PROCESSING, lockedAt: new Date() },
    });
    results.jobsClaimed++;

    try {
      if (job.jobType === "execute_recovery_action") {
        const payload = job.payload as unknown as ScheduledActionPayload;
        await executeScheduledAction(payload);
      }
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: { status: JobStatus.DONE },
      });
      results.jobsSucceeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.FAILED,
          lastError: message.slice(0, 2000),
          attempts: { increment: 1 },
        },
      });
      results.jobsFailed++;
    }
  }

  // 3. Pipeline: detect → classify → decide.
  try {
    const abandonment = await detectAbandonedCheckouts();
    results.abandonmentDetected = abandonment.createdCount;
  } catch (err) {
    logger.error({ err }, "orchestrator-tick: abandonment detection failed");
    Sentry.captureException(err);
  }

  // Capped per tick so a large backlog can't run the function past its
  // maxDuration — the next tick picks up whatever's left.
  const pendingCases = await prisma.case.findMany({
    where: { state: CaseState.DETECTED, classifiedCaseId: null },
    select: { id: true, recoveryEventId: true },
    orderBy: { createdAt: "asc" },
    take: 40,
  });

  for (const c of pendingCases) {
    try {
      const r = await classifyRecoveryEvent(c.recoveryEventId);
      if (r.transitioned) results.classified++;
    } catch (err) {
      logger.error({ err, caseId: c.id }, "orchestrator-tick: classify failed");
      Sentry.captureException(err);
    }
  }

  const diagnosedCases = await prisma.case.findMany({
    where: {
      state: CaseState.DIAGNOSED,
      scheduledJobs: {
        none: { status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
      },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: 40,
  });

  for (const c of diagnosedCases) {
    try {
      const r = await decideNextAction(c.id);
      if (r.action === "scheduled") results.scheduled++;
      else if (r.action === "skipped") results.skipped++;
      else if (r.action === "escalated") results.escalated++;
    } catch (err) {
      logger.error({ err, caseId: c.id }, "orchestrator-tick: decide failed");
      Sentry.captureException(err);
    }
  }

  // Emit a batch_summary SystemEvent — same shape the worker emits — so
  // the dashboard's SSE stream picks up this tick too.
  const recoveredThisTick = await prisma.case.count({
    where: { state: CaseState.RECOVERED, updatedAt: { gte: tickStartedAt } },
  });
  await emitBatchSummary(prisma, {
    processed: results.jobsClaimed,
    classified: results.classified,
    scheduled: results.scheduled,
    sent: results.jobsSucceeded,
    recovered: recoveredThisTick,
  });

  return results;
}

async function handleTick(request: NextRequest, allowSession: boolean) {
  if (!isAuthorizedCron(request)) {
    if (!allowSession) {
      return errorResponse("UNAUTHORIZED", "Valid cron secret required", 401);
    }
    const auth = await requireRole(request, [UserRole.ADMIN]);
    if (auth.response) return auth.response;
  }

  try {
    const results = await runOrchestratorTick();
    return successResponse(results);
  } catch (error) {
    logger.error({ err: error }, "orchestrator-tick failed");
    Sentry.captureException(error);
    return errorResponse(
      "ORCHESTRATOR_TICK_ERROR",
      "Failed to run orchestrator tick",
      500,
    );
  }
}

/** Dashboard "Run Batch" (ADMIN session) or an external scheduler (cron secret). */
export async function POST(request: NextRequest) {
  return handleTick(request, true);
}

/** Vercel Cron / external schedulers that issue GET (cron secret only). */
export async function GET(request: NextRequest) {
  return handleTick(request, false);
}
