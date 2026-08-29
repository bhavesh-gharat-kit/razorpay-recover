"use client";

/**
 * App Router's top-level error boundary — catches rendering errors that
 * escape every nested `error.tsx`. Reports to Sentry (a no-op if
 * `SENTRY_DSN` isn't configured, see `sentry.server.config.ts`) and shows
 * a minimal fallback so a crash never leaves the judge staring at a blank
 * white screen.
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: "3rem", fontFamily: "sans-serif" }}>
          <h1>Something went wrong</h1>
          <p>The error has been logged. Please refresh and try again.</p>
        </div>
      </body>
    </html>
  );
}
