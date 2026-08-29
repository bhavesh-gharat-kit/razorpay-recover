/**
 * Sentry init for the Next.js server runtime (API routes, Server
 * Components). Loaded from `instrumentation.ts`.
 *
 * If `SENTRY_DSN` isn't set, `Sentry.init` is simply never called — every
 * `Sentry.captureException` call elsewhere in the app becomes a silent
 * no-op, so the system works identically without a Sentry account. This
 * keeps the project demoable without requiring anyone to sign up for
 * anything.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    // Buildathon-scale traffic — 100% trace sampling is cheap and gives
    // full visibility without needing to tune a sample rate.
    tracesSampleRate: 1.0,
  });
}
