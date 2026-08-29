/**
 * Next.js instrumentation hook — runs once when the server process boots,
 * before any request is handled. Requires `experimental.instrumentationHook`
 * in `next.config.js` (Next 14; stable by default in 15+).
 *
 * Only the Node.js runtime is initialized — this app has no Edge Runtime
 * routes or middleware, so there's no `sentry.edge.config.ts` to load.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}
