/**
 * Shared structured logger (pino). Every module that used to call
 * `console.log` / `console.error` / `console.warn` imports `logger` from
 * here instead and passes a structured context object first, message
 * string second — e.g.:
 *
 *   logger.info({ caseId, state: "DIAGNOSED", causeCode }, "case classified");
 *   logger.error({ err, jobId }, "scheduled job failed");
 *
 * Output shape:
 *   - production: newline-delimited JSON on stdout/stderr — this is what
 *     PM2 writes to `~/.pm2/logs/recover-{web,worker}-{out,error}.log`
 *     (see ecosystem.config.js), ready for any log aggregator later.
 *   - development: pretty-printed, colorized single-line output via
 *     `pino-pretty` (a dev dependency only — never required in prod).
 *
 * Level comes from `LOG_LEVEL` (see lib/env.ts), defaulting to `info` in
 * production and `debug` in development.
 */

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

const level =
  process.env.LOG_LEVEL && process.env.LOG_LEVEL.trim() !== ""
    ? process.env.LOG_LEVEL.trim()
    : isProduction
      ? "info"
      : "debug";

export const logger = pino({
  level,
  // Pretty-print in development only — production stays plain JSON so PM2's
  // log files and any future aggregator can parse it as NDJSON.
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
  base: isProduction ? { pid: process.pid } : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
