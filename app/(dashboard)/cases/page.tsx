"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CaseState, Scenario } from "@prisma/client";
import { apiFetch, ApiRequestError } from "@/lib/api/client";
import { formatAmountINR } from "@/lib/messaging/formatAmount";
import { relativeTime } from "@/lib/format/relativeTime";
import { StateBadge } from "@/components/StateBadge";
import { ScenarioBadge } from "@/components/ScenarioBadge";
import { useEventStream } from "@/lib/hooks/useEventStream";

interface CaseListItem {
  id: string;
  state: CaseState;
  attemptCount: number;
  maxAttempts: number;
  updatedAt: string;
  customerName: string;
  customerEmail: string;
  merchantName: string;
  amountPaise: number;
  currency: string;
  scenario: Scenario;
  razorpayRefId: string | null;
  causeCode: string | null;
  confidence: number | null;
  recoveredAmountPaise: number | null;
  recoveryLinkStatus: "no_link" | "has_link" | "link_paid";
  recoveryLinkUrl: string | null;
}

interface CasesResponse {
  items: CaseListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATE_OPTIONS: CaseState[] = [
  "DETECTED",
  "DIAGNOSED",
  "ACTION_SCHEDULED",
  "ACTION_SENT",
  "RECOVERED",
  "ESCALATED",
  "ABANDONED",
  "CLOSED",
];

const SCENARIO_OPTIONS: Scenario[] = ["CHECKOUT_DROPOFF", "SUBSCRIPTION_FAILURE", "INVOICE_OVERDUE"];

const LINK_STATUS_LABEL: Record<CaseListItem["recoveryLinkStatus"], string> = {
  no_link: "No link",
  has_link: "Link sent",
  link_paid: "Link paid",
};

export default function CasesPage() {
  const router = useRouter();
  const [state, setState] = useState("");
  const [causeCode, setCauseCode] = useState("");
  const [scenario, setScenario] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [data, setData] = useState<CasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (state) params.set("state", state);
      if (causeCode) params.set("causeCode", causeCode);
      if (scenario) params.set("scenario", scenario);
      if (search) params.set("search", search);
      const result = await apiFetch<CasesResponse>(`/api/cases?${params.toString()}`);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to load cases");
    } finally {
      setLoading(false);
    }
  }, [page, state, causeCode, scenario, search]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh: any case_transition/batch_summary event might change
  // what this table should show — debounce a refetch of the current page.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEventStream(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(load, 500);
  });

  const clearFilters = () => {
    setState("");
    setCauseCode("");
    setScenario("");
    setSearchInput("");
    setSearch("");
    setPage(1);
  };

  const hasFilters = Boolean(state || causeCode || scenario || search);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Cases</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every recovery case, searchable and filterable.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search name, email, or Razorpay ref…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-64 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">All states</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={scenario}
          onChange={(e) => {
            setScenario(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">All scenarios</option>
          {SCENARIO_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Cause code"
          value={causeCode}
          onChange={(e) => {
            setCauseCode(e.target.value.toUpperCase());
            setPage(1);
          }}
          className="w-40 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <th className="px-3 py-2">Customer</th>
              <th className="hidden px-3 py-2 md:table-cell">Merchant</th>
              <th className="hidden px-3 py-2 sm:table-cell">Scenario</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="hidden px-3 py-2 lg:table-cell">Cause</th>
              <th className="px-3 py-2">State</th>
              <th className="hidden px-3 py-2 text-right md:table-cell">Attempts</th>
              <th className="hidden px-3 py-2 lg:table-cell">Link</th>
              <th className="hidden px-3 py-2 sm:table-cell">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows />
            ) : data && data.items.length > 0 ? (
              data.items.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/cases/${c.id}`)}
                  className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60 ${
                    i % 2 === 1 ? "bg-slate-50/50 dark:bg-slate-900/40" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{c.customerName}</div>
                    <div className="text-xs text-slate-400">{c.customerEmail}</div>
                  </td>
                  <td className="hidden px-3 py-2 text-slate-600 dark:text-slate-300 md:table-cell">{c.merchantName}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <ScenarioBadge scenario={c.scenario} />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                    {formatAmountINR(c.amountPaise, c.currency)}
                  </td>
                  <td className="hidden px-3 py-2 text-slate-600 dark:text-slate-300 lg:table-cell">{c.causeCode ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StateBadge state={c.state} />
                  </td>
                  <td className="hidden px-3 py-2 text-right text-slate-600 dark:text-slate-300 md:table-cell">
                    {c.attemptCount}/{c.maxAttempts}
                  </td>
                  <td className="hidden px-3 py-2 text-slate-500 dark:text-slate-400 lg:table-cell">
                    {LINK_STATUS_LABEL[c.recoveryLinkStatus]}
                  </td>
                  <td className="hidden px-3 py-2 text-slate-400 sm:table-cell" title={c.updatedAt}>
                    {relativeTime(c.updatedAt)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                  <p className="mb-2">No cases match your filters.</p>
                  {hasFilters && (
                    <button onClick={clearFilters} className="text-sm text-slate-600 underline dark:text-slate-300">
                      Clear filters
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>
            Page {data.page} of {data.totalPages} ({data.total} total)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
          {Array.from({ length: 9 }).map((__, j) => (
            <td key={j} className="px-3 py-3">
              <div className="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
