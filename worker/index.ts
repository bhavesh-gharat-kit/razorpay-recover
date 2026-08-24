/**
 * Worker process — standalone cron poller for the ScheduledJob table.
 *
 * Runs as a second PM2 process alongside the Next.js web app (see
 * ecosystem.config.js). Uses node-cron to tick every 60 seconds.
 *
 * Each tick:
 *   1. (First tick only) Recover stale jobs stuck in PROCESSING.
 *   2. Claim due PENDING jobs using SELECT ... FOR UPDATE SKIP LOCKED.
 *   3. Execute each claimed job (dispatch by jobType).
 *   4. Run the detect → classify → decide pipeline directly (same codebase).
 *   5. Log a tick summary.
 *
 * No Redis, no BullMQ — the DB is the queue. See CLAUDE.md.
 */

import cron from "node-cron";
import { PrismaClient, CaseState, JobStatus } from "@prisma/client";
import { classifyRecoveryEvent } from "../lib/classification/classify";
import { detectAbandonedCheckouts } from "../lib/ingestion/detect-abandonment";
import {
  decideNextAction,
  executeScheduledAction,
} from "../lib/orchestrator/orchestrator";
import type { ScheduledActionPayload } from "../lib/orchestrator/orchestrator";

// Worker gets its own PrismaClient — it doesn't share the Next.js singleton
// because it runs as a separate OS process.
const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isFirstTick = true;
const BATCH_SIZE = 20;
const STALE_LOCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Stale job recovery (first tick only)
// ---------------------------------------------------------------------------

async function recoverStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_THRESHOLD_MS);

  const result = await prisma.scheduledJob.updateMany({
    where: {
      status: JobStatus.PROCESSING,
      lockedAt: { lt: cutoff },
    },
    data: {
      status: JobStatus.PENDING,
      lockedAt: null,
      lastError: "stale_lock_reset_on_startup",
    },
  });

  return result.count;
}

// ---------------------------------------------------------------------------
// Claim and execute jobs
// ---------------------------------------------------------------------------

interface ClaimedJob {
  id: string;
  jobType: string;
  payload: unknown;
}

/**
 * Atomically claim due jobs using SELECT ... FOR UPDATE SKIP LOCKED.
 * This prevents double-processing even if ticks overlap.
 */
async function claimJobs(): Promise<ClaimedJob[]> {
  // Raw query because Prisma doesn't support FOR UPDATE SKIP LOCKED natively.
  const jobs = await prisma.$queryRaw<ClaimedJob[]>`
    SELECT id, jobType, payload
    FROM ScheduledJob
    WHERE status = 'PENDING' AND runAt <= NOW()
    ORDER BY runAt ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  `;

  if (jobs.length === 0) return [];

  // Mark them all as PROCESSING with a lock timestamp.
  const jobIds = jobs.map((j) => j.id);
  await prisma.scheduledJob.updateMany({
    where: { id: { in: jobIds } },
    data: {
      status: JobStatus.PROCESSING,
      lockedAt: new Date(),
    },
  });

  return jobs;
}

async function executeJob(job: ClaimedJob): Promise<void> {
  try {
    switch (job.jobType) {
      case "execute_recovery_action": {
        // Parse the payload — it comes as a JSON object from the raw query.
        const payload =
          typeof job.payload === "string"
            ? (JSON.parse(job.payload) as ScheduledActionPayload)
            : (job.payload as ScheduledActionPayload);
        await executeScheduledAction(payload);
        break;
      }
      default:
        throw new Error(`Unknown jobType: ${job.jobType}`);
    }

    // Mark as DONE.
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { status: JobStatus.DONE },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Job ${job.id} (${job.jobType}) failed:`, message);

    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        status: JobStatus.FAILED,
        lastError: message.slice(0, 2000),
        attempts: { increment: 1 },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Pipeline: detect → classify → decide
// ---------------------------------------------------------------------------

interface PipelineResult {
  abandonmentDetected: number;
  classified: number;
  classifyErrors: number;
  decided: number;
  decideSkipped: number;
  decideEscalated: number;
}

async function runPipeline(): Promise<PipelineResult> {
  const result: PipelineResult = {
    abandonmentDetected: 0,
    classified: 0,
    classifyErrors: 0,
    decided: 0,
    decideSkipped: 0,
    decideEscalated: 0,
  };

  // Step 1: Detect abandoned checkouts.
  try {
    const abandonment = await detectAbandonedCheckouts();
    result.abandonmentDetected = abandonment.createdCount;
  } catch (err) {
    console.error("[worker] Abandonment detection error:", err);
  }

  // Step 2: Classify DETECTED cases.
  const pendingCases = await prisma.case.findMany({
    where: {
      state: CaseState.DETECTED,
      classifiedCaseId: null,
    },
    select: { id: true, recoveryEventId: true },
  });

  for (const c of pendingCases) {
    try {
      const classResult = await classifyRecoveryEvent(c.recoveryEventId);
      if (classResult.transitioned) result.classified++;
    } catch (err) {
      console.error(`[worker] Classification error for case ${c.id}:`, err);
      result.classifyErrors++;
    }
  }

  // Step 3: Decide next action for DIAGNOSED cases that don't already have
  // a pending ScheduledJob.
  const diagnosedCases = await prisma.case.findMany({
    where: {
      state: CaseState.DIAGNOSED,
      scheduledJobs: {
        none: {
          status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] },
        },
      },
    },
    select: { id: true },
  });

  for (const c of diagnosedCases) {
    try {
      const decideResult = await decideNextAction(c.id);
      switch (decideResult.action) {
        case "scheduled":
          result.decided++;
          break;
        case "skipped":
          result.decideSkipped++;
          break;
        case "escalated":
          result.decideEscalated++;
          break;
      }
    } catch (err) {
      console.error(`[worker] decideNextAction error for case ${c.id}:`, err);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

export async function tick(): Promise<void> {
  const tickStart = Date.now();

  // First tick: recover stale jobs.
  if (isFirstTick) {
    const recovered = await recoverStaleJobs();
    if (recovered > 0) {
      console.log(`[worker] Recovered ${recovered} stale job(s) on startup.`);
    }
    isFirstTick = false;
  }

  // Claim and execute due jobs.
  let jobsProcessed = 0;
  let jobsSucceeded = 0;
  let jobsFailed = 0;

  try {
    const claimed = await claimJobs();
    jobsProcessed = claimed.length;

    for (const job of claimed) {
      try {
        await executeJob(job);
        jobsSucceeded++;
      } catch {
        jobsFailed++;
      }
    }
  } catch (err) {
    console.error("[worker] Job claiming error:", err);
  }

  // Run the detect → classify → decide pipeline.
  let pipeline: PipelineResult | null = null;
  try {
    pipeline = await runPipeline();
  } catch (err) {
    console.error("[worker] Pipeline error:", err);
  }

  // Tick summary.
  const elapsed = Date.now() - tickStart;
  const parts = [
    `jobs: ${jobsProcessed} claimed, ${jobsSucceeded} ok, ${jobsFailed} failed`,
  ];
  if (pipeline) {
    parts.push(
      `pipeline: ${pipeline.abandonmentDetected} abandoned, ` +
        `${pipeline.classified} classified, ` +
        `${pipeline.decided} scheduled, ` +
        `${pipeline.decideSkipped} skipped, ` +
        `${pipeline.decideEscalated} escalated`,
    );
  }
  console.log(`[worker] tick (${elapsed}ms) — ${parts.join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Cron loop — every 60 seconds
// ---------------------------------------------------------------------------

console.log("[worker] Starting cron loop (every 60s)...");

// Run one tick immediately on startup.
tick().catch((err) => {
  console.error("[worker] Initial tick error:", err);
});

cron.schedule("* * * * *", () => {
  tick().catch((err) => {
    console.error("[worker] Tick error:", err);
  });
});
