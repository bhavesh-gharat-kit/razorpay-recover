"use client";

import { useEffect, useRef, useState } from "react";
import { Timeline } from "@/components/Timeline";
import type { TimelineEntry } from "@/lib/audit/timeline";

const TERMINAL_STATES = new Set([
  "RECOVERED",
  "ACTION_SENT",
  "CLOSED",
  "ESCALATED",
]);

const MAX_POLLS = 20;
const POLL_INTERVAL_MS = 3000;

interface DemoCaseResponse {
  caseId: string;
  state: string;
  scenario: string;
  causeCode: string | null;
  confidence: number | null;
  classificationSource: string | null;
  amountPaise: number;
  currency: string;
  customerEmailMasked: string;
  recoveryLinkUrl: string | null;
  createdAt: string;
  timeline: TimelineEntry[];
}

/** Indian comma grouping (₹1,00,000) via Intl.NumberFormat("en-IN"). */
function formatINR(amountPaise: number, currency = "INR"): string {
  const rupees = amountPaise / 100;
  if (currency === "INR") {
    return "₹" + new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(rupees);
  }
  return `${currency} ${rupees.toFixed(2)}`;
}

function StateBadge({ state }: { state: string }) {
  const cls =
    state === "RECOVERED"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : state === "ACTION_SENT"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
        : state === "ESCALATED" || state === "CLOSED"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
          : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {state}
    </span>
  );
}

export function DemoCaseTimeline({ caseId }: { caseId: string }) {
  const [data, setData] = useState<DemoCaseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;
      pollsRef.current += 1;
      try {
        const res = await fetch(`/api/demo/case/${caseId}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error?.message ?? "Failed to load case");
          return;
        }
        setData(json.data as DemoCaseResponse);
        const state = json.data.state as string;
        if (
          !TERMINAL_STATES.has(state) &&
          pollsRef.current < MAX_POLLS
        ) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [caseId]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        Loading case…
      </div>
    );
  }

  return (
    <section
      aria-label="Live recovery timeline"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-semibold">Recovery in progress</h2>
          <StateBadge state={data.state} />
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Case {data.caseId.slice(-8)}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Amount</dt>
          <dd className="font-medium">{formatINR(data.amountPaise, data.currency)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Cause</dt>
          <dd className="font-medium">
            {data.causeCode ?? "…"}
            {data.confidence != null && (
              <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                ({data.confidence.toFixed(2)})
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Recipient</dt>
          <dd className="font-medium">{data.customerEmailMasked}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Scenario</dt>
          <dd className="font-medium">{data.scenario}</dd>
        </div>
      </dl>

      {data.recoveryLinkUrl && (
        <div>
          <a
            href={data.recoveryLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            Open recovery link →
          </a>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            The same URL sent in the drafted email.
          </p>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Audit timeline
        </h3>
        <Timeline entries={data.timeline} />
      </div>
    </section>
  );
}
