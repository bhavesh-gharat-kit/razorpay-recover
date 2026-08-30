/**
 * `isAuthorizedCron` — lets the scheduled orchestrator tick authenticate
 * without an admin session.
 *
 * On Vercel there is no long-running worker process, so the pipeline is
 * driven by an external scheduler (Vercel Cron, or a service like
 * cron-job.org) hitting `/api/internal/run-orchestrator-tick`. Vercel Cron
 * automatically sends `Authorization: Bearer <CRON_SECRET>` when the
 * `CRON_SECRET` env var is set; external schedulers should be configured
 * to send the same header.
 *
 * Returns `false` (never throws) when `CRON_SECRET` is unset — so a
 * deployment without a cron secret simply falls back to session auth.
 */

import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : header;
  if (!provided) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
