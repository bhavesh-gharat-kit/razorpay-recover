/**
 * POST /api/internal/run-orchestrator-tick
 *
 * Triggers one worker-tick's worth of work on demand — useful during
 * development without waiting 60 seconds for the cron loop.
 *
 * Gated to ADMIN sessions (Phase 7).
 */

import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api/response";
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
import { emitBatchSummary } from "@/lib/events/emit";

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, [UserRole.ADMIN]);
  if (auth.response) return auth.response;

  const tickStartedAt = new Date();

  try {
    const results = {
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
        lastError: "stale_lock_reset_via_manual_tick",
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
      console.error("[orchestrator-tick] Abandonment error:", err);
    }

    const pendingCases = await prisma.case.findMany({
      where: { state: CaseState.DETECTED, classifiedCaseId: null },
      select: { id: true, recoveryEventId: true },
    });

    for (const c of pendingCases) {
      try {
        const r = await classifyRecoveryEvent(c.recoveryEventId);
        if (r.transitioned) results.classified++;
      } catch (err) {
        console.error(`[orchestrator-tick] Classify error ${c.id}:`, err);
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
    });

    for (const c of diagnosedCases) {
      try {
        const r = await decideNextAction(c.id);
        if (r.action === "scheduled") results.scheduled++;
        else if (r.action === "skipped") results.skipped++;
        else if (r.action === "escalated") results.escalated++;
      } catch (err) {
        console.error(`[orchestrator-tick] Decide error ${c.id}:`, err);
      }
    }

    // Emit a batch_summary SystemEvent — same shape the worker emits — so
    // the dashboard's SSE stream picks up this manually-triggered tick too.
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

    return successResponse(results);
  } catch (error) {
    console.error("[orchestrator-tick] Error:", error);
    return errorResponse(
      "ORCHESTRATOR_TICK_ERROR",
      "Failed to run orchestrator tick",
      500,
    );
  }
}
