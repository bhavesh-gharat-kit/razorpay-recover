"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalyticsSummary } from "@/lib/analytics/summary";
import type { Scenario } from "@prisma/client";
import { apiFetch, ApiRequestError } from "@/lib/api/client";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { formatAmountINR } from "@/lib/messaging/formatAmount";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ConnectionDot } from "@/components/ConnectionDot";
import { DailyTrendChart } from "@/components/DailyTrendChart";

const SCENARIO_OPTIONS: { value: Scenario | "ALL"; label: string }[] = [
  { value: "ALL", label: "All scenarios" },
  { value: "CHECKOUT_DROPOFF", label: "Checkout Drop-off" },
  { value: "SUBSCRIPTION_FAILURE", label: "Subscription Failure" },
  { value: "INVOICE_OVERDUE", label: "Invoice Overdue" },
];

interface BatchResult {
  processed: number;
  classified: number;
  scheduled: number;
  sent: number;
  recovered: number;
}

export default function SummaryPage() {
  const [scenario, setScenario] = useState<Scenario | "ALL">("ALL");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastBatch, setLastBatch] = useState<BatchResult | null>(null);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (s: Scenario | "ALL") => {
    try {
      const qs = s === "ALL" ? "" : `?scenario=${s}`;
      const data = await apiFetch<AnalyticsSummary>(`/api/analytics/summary${qs}`);
      setSummary(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(scenario);
  }, [scenario, load]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => load(scenario), 400);
  }, [load, scenario]);

  const connectionStatus = useEventStream((msg) => {
    if (msg.type === "batch_summary") {
      setLastBatch(msg.data);
    }
    // Any live event means the underlying numbers may have moved —
    // debounce so a burst of case_transition rows triggers one refetch.
    scheduleRefetch();
  });

  async function handleRunBatch() {
    setRunning(true);
    try {
      const result = await apiFetch<BatchResult & Record<string, number>>(
        "/api/internal/run-orchestrator-tick",
        { method: "POST" },
      );
      setLastBatch({
        processed: result.jobsClaimed ?? 0,
        classified: result.classified ?? 0,
        scheduled: result.scheduled ?? 0,
        sent: result.jobsSucceeded ?? 0,
        recovered: 0,
      });
      await load(scenario);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Batch run failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Recovery Summary
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Headline numbers for the recovery engine, live-updated as the worker runs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionDot status={connectionStatus} />
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as Scenario | "ALL")}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {SCENARIO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleRunBatch}
            disabled={running}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {running ? "Running…" : "Run Batch"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {lastBatch && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Last tick — processed {lastBatch.processed}, classified {lastBatch.classified}, scheduled{" "}
          {lastBatch.scheduled}, sent {lastBatch.sent}, recovered {lastBatch.recovered}.
        </p>
      )}

      {loading && !summary ? (
        <SkeletonCards />
      ) : summary ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total at-risk"
              value={summary.totalAtRiskPaise}
              format={(n) => formatAmountINR(Math.round(n), "INR")}
            />
            <StatCard
              label="Total recovered"
              value={summary.totalRecoveredPaise}
              format={(n) => formatAmountINR(Math.round(n), "INR")}
              accent="text-green-600 dark:text-green-400"
            />
            <StatCard
              label="Recovery rate"
              value={summary.recoveryRate * 100}
              format={(n) => `${n.toFixed(1)}%`}
            />
            <StatCard
              label="Avg time to recovery"
              value={summary.avgTimeToRecoveryMinutes ?? 0}
              format={(n) =>
                summary.avgTimeToRecoveryMinutes == null
                  ? "—"
                  : n >= 60
                    ? `${(n / 60).toFixed(1)} hrs`
                    : `${Math.round(n)} min`
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel title="By cause code">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <th className="py-1.5 pr-2">Cause</th>
                    <th className="py-1.5 pr-2 text-right">Detected</th>
                    <th className="py-1.5 pr-2 text-right">Recovered</th>
                    <th className="py-1.5 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.breakdownByCauseCode.map((row, i) => (
                    <tr
                      key={row.causeCode}
                      className={i % 2 === 1 ? "bg-slate-50 dark:bg-slate-900/50" : ""}
                    >
                      <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-300">{row.causeCode}</td>
                      <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                        {row.detected}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                        {row.recovered}
                      </td>
                      <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">
                        {(row.recoveryRate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                  {summary.breakdownByCauseCode.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-400">
                        No data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>

            <Panel title="By channel">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    <th className="py-1.5 pr-2">Channel</th>
                    <th className="py-1.5 pr-2 text-right">Sent</th>
                    <th className="py-1.5 pr-2 text-right">Delivered</th>
                    <th className="py-1.5 text-right">Recovery rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.breakdownByChannel.map((row, i) => (
                    <tr
                      key={row.channel}
                      className={i % 2 === 1 ? "bg-slate-50 dark:bg-slate-900/50" : ""}
                    >
                      <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-300">{row.channel}</td>
                      <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                        {row.sent}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                        {row.delivered}
                      </td>
                      <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">
                        {(row.recoveryRate * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                  {summary.breakdownByChannel.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-400">
                        No data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Panel>
          </div>

          <Panel title="Daily trend">
            <DailyTrendChart points={summary.dailyTrend} />
            <div className="mt-2 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-slate-200 dark:bg-slate-700" /> Detected
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-green-500" /> Recovered
              </span>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  format,
  accent,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${accent ?? "text-slate-900 dark:text-slate-100"}`}>
        <AnimatedNumber value={value} format={format} />
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{title}</h2>
      {children}
    </div>
  );
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
        />
      ))}
    </div>
  );
}
