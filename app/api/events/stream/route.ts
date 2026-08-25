/**
 * GET /api/events/stream
 *
 * Server-Sent Events endpoint for live dashboard updates. Any signed-in
 * role may watch. Polls the `SystemEvent` table every 2 seconds for rows
 * newer than the last check and relays each as an SSE event named after
 * its `eventType` (`case_transition`, `batch_summary`, `recovery_detected`).
 *
 * This is the simplest cross-process signal that works with "single
 * Next.js app + a separate worker process, no Redis": the worker writes
 * rows, this route polls for them. See `lib/events/emit.ts` for writers.
 */

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/requireRole";
import { UserRole } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_INTERVAL_MS = 2000;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, [
    UserRole.ADMIN,
    UserRole.REVIEWER,
    UserRole.VIEWER,
  ]);
  if (auth.response) return auth.response;

  const encoder = new TextEncoder();
  let sinceCursor = new Date();
  let closed = false;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller already closed (client disconnected mid-write) — ignore.
        }
      };

      send("connected", { at: sinceCursor.toISOString() });

      const poll = async () => {
        if (closed) return;
        try {
          const rows = await prisma.systemEvent.findMany({
            where: { createdAt: { gt: sinceCursor } },
            orderBy: { createdAt: "asc" },
            take: 100,
          });

          if (rows.length > 0) {
            sinceCursor = rows[rows.length - 1].createdAt;
            for (const row of rows) {
              send(row.eventType, row.payload);
            }
          } else {
            // Comment-only "ping" line — keeps proxies/browsers from timing
            // out an idle connection without invoking any client listener.
            controller.enqueue(encoder.encode(`: ping\n\n`));
          }
        } catch (err) {
          console.error("[sse] poll error:", err);
        }
      };

      intervalHandle = setInterval(poll, POLL_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        closed = true;
        if (intervalHandle) clearInterval(intervalHandle);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      closed = true;
      if (intervalHandle) clearInterval(intervalHandle);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
