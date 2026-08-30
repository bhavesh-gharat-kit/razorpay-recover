"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { TimelineEntry } from "@/lib/audit/timeline";
import { apiFetch, ApiRequestError } from "@/lib/api/client";
import { formatAmountINR } from "@/lib/messaging/formatAmount";
import { StateBadge } from "@/components/StateBadge";
import { Timeline } from "@/components/Timeline";

interface CaseSearchResult {
  id: string;
  customerName: string;
  customerEmail: string;
  causeCode: string | null;
  state: string;
  amountPaise: number;
  currency: string;
}

/**
 * Standalone Audit page — search for a case, then read its full audit
 * timeline (same data + component the Case Detail page uses). Deep-links
 * via `?caseId=`, so a link into this page always lands on the right case.
 */
export default function AuditPage() {
  return (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />}>
      <AuditPageInner />
    </Suspense>
  );
}

function AuditPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseIdFromUrl = searchParams.get("caseId");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CaseSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentCases, setRecentCases] = useState<CaseSearchResult[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(caseIdFromUrl);
  const [selectedCase, setSelectedCase] = useState<CaseSearchResult | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent cases on mount so the page isn't empty
  useEffect(() => {
    apiFetch<{ items: CaseSearchResult[] }>("/api/cases?limit=10")
      .then((data) => setRecentCases(data.items))
      .catch(() => {})
      .finally(() => setLoadingRecent(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await apiFetch<{ items: CaseSearchResult[] }>(
          `/api/cases?limit=8&search=${encodeURIComponent(query.trim())}`,
        );
        setResults(data.items);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (!selectedCaseId) {
      setSelectedCase(null);
      setTimeline([]);
      return;
    }
    setLoadingTimeline(true);
    setError(null);
    Promise.all([
      apiFetch<{ case: CaseSearchResult }>(`/api/cases/${selectedCaseId}`),
      apiFetch<{ entries: TimelineEntry[] }>(`/api/audit?caseId=${selectedCaseId}`),
    ])
      .then(([caseData, auditData]) => {
        setSelectedCase(caseData.case);
        setTimeline(auditData.entries);
      })
      .catch((err) => {
        setError(err instanceof ApiRequestError ? err.message : "Failed to load audit trail");
      })
      .finally(() => setLoadingTimeline(false));
  }, [selectedCaseId]);

  function selectCase(id: string) {
    setSelectedCaseId(id);
    setResults([]);
    setQuery("");
    router.replace(`/audit?caseId=${id}`);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Audit trail</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Search for a case to see its full, chronological audit history.
        </p>
      </div>

      <div className="relative max-w-md">
        <input
          type="search"
          placeholder="Search by customer name, email, or Razorpay ref…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        {(searching || results.length > 0) && query.trim().length >= 2 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {searching ? (
              <p className="px-3 py-2 text-sm text-slate-400">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">No matches.</p>
            ) : (
              results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => selectCase(r.id)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-200">{r.customerName}</span>{" "}
                  <span className="text-slate-400">{r.customerEmail}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Recent cases — show when no case is selected and no search active */}
      {!selectedCaseId && query.trim().length < 2 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Recent cases</h2>
          {loadingRecent ? (
            <div className="h-16 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
          ) : recentCases.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No cases yet.</p>
          ) : (
            <div className="space-y-1">
              {recentCases.map((r) => (
                <button
                  key={r.id}
                  onClick={() => selectCase(r.id)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div>
                    <span className="font-medium text-slate-800 dark:text-slate-200">{r.customerName}</span>{" "}
                    <span className="text-slate-400">{r.customerEmail}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{r.causeCode ?? "Unclassified"}</span>
                    <StateBadge state={r.state} />
                  </div>
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            Select a case to view its full audit trail, or search above.
          </p>
        </div>
      )}

      {selectedCaseId && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          {loadingTimeline ? (
            <div className="h-24 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
          ) : selectedCase ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    {selectedCase.customerName} · {formatAmountINR(selectedCase.amountPaise, selectedCase.currency)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {selectedCase.causeCode ?? "Unclassified"} ·{" "}
                    <Link href={`/cases/${selectedCase.id}`} className="underline">
                      Open full case
                    </Link>
                  </p>
                </div>
                <StateBadge state={selectedCase.state} />
              </div>
              <Timeline entries={timeline} />
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">Case not found.</p>
          )}
        </div>
      )}
    </div>
  );
}
