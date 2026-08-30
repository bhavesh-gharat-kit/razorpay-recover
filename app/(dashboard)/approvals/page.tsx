"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ApprovalQueueItem, ApprovalReason } from "@/lib/approval/queue";
import type { Scenario } from "@prisma/client";
import { CAUSE_CODES } from "@/lib/classification/rules";
import { apiFetch, ApiRequestError } from "@/lib/api/client";
import { formatAmountINR } from "@/lib/messaging/formatAmount";
import { relativeTime } from "@/lib/format/relativeTime";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { useEventStream } from "@/lib/hooks/useEventStream";
import { Toast } from "@/components/Toast";

const REASON_LABEL: Record<ApprovalReason, string> = {
  below_threshold: "Below confidence threshold",
  amount_over_threshold: "Amount over review threshold",
  escalated: "Escalated",
};

const SCENARIO_OPTIONS: { value: Scenario; label: string }[] = [
  { value: "CHECKOUT_DROPOFF", label: "Checkout Drop-off" },
  { value: "SUBSCRIPTION_FAILURE", label: "Subscription Failure" },
  { value: "INVOICE_OVERDUE", label: "Invoice Overdue" },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount_desc", label: "Amount (high → low)" },
  { value: "amount_asc", label: "Amount (low → high)" },
];

interface DraftForEdit {
  id: string;
  body: string;
  subject: string | null;
}

interface ApprovalsResponse {
  count: number;
  items: ApprovalQueueItem[];
  page: number;
  limit: number;
  totalPages: number;
}

export default function ApprovalsPage() {
  const { user } = useCurrentUser();
  const canAct = user?.role === "ADMIN" || user?.role === "REVIEWER";

  const [items, setItems] = useState<ApprovalQueueItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Filters & pagination
  const [page, setPage] = useState(1);
  const [scenarioFilter, setScenarioFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [sort, setSort] = useState("newest");

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [reclassifyCaseId, setReclassifyCaseId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25", sort });
      if (scenarioFilter) params.set("scenario", scenarioFilter);
      if (reasonFilter) params.set("reason", reasonFilter);
      const data = await apiFetch<ApprovalsResponse>(`/api/approvals?${params.toString()}`);
      setItems(data.items);
      setTotalCount(data.count);
      setTotalPages(data.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to load approval queue");
    } finally {
      setLoading(false);
    }
  }, [page, scenarioFilter, reasonFilter, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEventStream(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(load, 500);
  });

  const ACTION_TOAST: Record<string, string> = {
    approve: "Case approved — orchestrator will resume.",
    reject: "Case rejected and closed.",
    "mark-recovered": "Case marked as recovered.",
  };

  async function act(caseId: string, name: string, fn: () => Promise<unknown>) {
    setBusy(`${caseId}:${name}`);
    try {
      await fn();
      setToast({ message: ACTION_TOAST[name] ?? `${name} completed.`, type: "success" });
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : `${name} failed`;
      setError(msg);
      setToast({ message: msg, type: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Approval queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cases waiting on a human decision — below-confidence classifications, big-ticket amounts, and
          escalations.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scenarioFilter}
          onChange={(e) => { setScenarioFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">All scenarios</option>
          {SCENARIO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={reasonFilter}
          onChange={(e) => { setReasonFilter(e.target.value); setPage(1); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">All reasons</option>
          <option value="below_threshold">Below confidence</option>
          <option value="amount_over_threshold">Amount over threshold</option>
          <option value="escalated">Escalated</option>
        </select>
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {(scenarioFilter || reasonFilter) && (
          <button
            onClick={() => { setScenarioFilter(""); setReasonFilter(""); setPage(1); }}
            className="text-sm text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
          {totalCount} item{totalCount !== 1 ? "s" : ""}
        </span>
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
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="hidden px-3 py-2 md:table-cell">Cause</th>
              <th className="hidden px-3 py-2 sm:table-cell">Reason</th>
              <th className="hidden px-3 py-2 sm:table-cell">In queue</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  Nothing waiting on review right now.
                </td>
              </tr>
            ) : (
              items.map((item, i) => (
                <tr
                  key={item.caseId}
                  className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                    i % 2 === 1 ? "bg-slate-50/50 dark:bg-slate-900/40" : ""
                  }`}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200">{item.customerName}</div>
                    <div className="text-xs text-slate-400">{item.customerEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                    {formatAmountINR(item.amountPaise, item.currency)}
                  </td>
                  <td className="hidden px-3 py-2 text-slate-600 dark:text-slate-300 md:table-cell">{item.causeCode ?? "—"}</td>
                  <td className="hidden px-3 py-2 text-slate-600 dark:text-slate-300 sm:table-cell">{REASON_LABEL[item.reason]}</td>
                  <td className="hidden px-3 py-2 text-slate-400 sm:table-cell">{relativeTime(item.latestTransitionAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <ActionLink
                        label="Approve"
                        disabled={!canAct}
                        busy={busy === `${item.caseId}:approve`}
                        onClick={() =>
                          act(item.caseId, "approve", () =>
                            apiFetch(`/api/approvals/${item.caseId}/approve`, { method: "POST" }),
                          )
                        }
                      />
                      <ActionLink
                        label="Reject"
                        disabled={!canAct}
                        busy={busy === `${item.caseId}:reject`}
                        onClick={() =>
                          act(item.caseId, "reject", () =>
                            apiFetch(`/api/approvals/${item.caseId}/reject`, { method: "POST" }),
                          )
                        }
                      />
                      {item.state !== "DIAGNOSED" && item.state !== "DETECTED" && (
                        <ActionLink
                          label="Edit Draft"
                          disabled={!canAct}
                          onClick={() => setEditingCaseId(item.caseId)}
                        />
                      )}
                      <ActionLink
                        label="Reclassify"
                        disabled={!canAct}
                        onClick={() => setReclassifyCaseId(item.caseId)}
                      />
                      <Link
                        href={`/cases/${item.caseId}`}
                        className="text-xs font-medium text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        View Case
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>Page {page} of {totalPages} ({totalCount} total)</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40 dark:border-slate-700"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {editingCaseId && (
        <EditDraftModal
          caseId={editingCaseId}
          onClose={() => setEditingCaseId(null)}
          onSaved={() => {
            setEditingCaseId(null);
            load();
          }}
        />
      )}

      {reclassifyCaseId && (
        <ReclassifyModal
          caseId={reclassifyCaseId}
          onClose={() => setReclassifyCaseId(null)}
          onSaved={() => {
            setReclassifyCaseId(null);
            setToast({ message: "Case reclassified.", type: "success" });
            load();
          }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function ActionLink({
  label,
  onClick,
  disabled,
  busy,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={disabled ? "Reviewer or Admin access required" : undefined}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {busy ? "…" : label}
    </button>
  );
}

function EditDraftModal({
  caseId,
  onClose,
  onSaved,
}: {
  caseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DraftForEdit | null | undefined>(undefined); // undefined = loading
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{
      case: { draftMessages: { id: string; body: string; subject: string | null; deliveryAttempts: unknown[] }[] };
    }>(`/api/cases/${caseId}`)
      .then((data) => {
        const editable = [...data.case.draftMessages]
          .reverse()
          .find((d) => d.deliveryAttempts.length === 0);
        setDraft(editable ? { id: editable.id, body: editable.body, subject: editable.subject } : null);
        setBody(editable?.body ?? "");
      })
      .catch(() => setDraft(null));
  }, [caseId]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/approvals/${caseId}/edit-draft`, {
        method: "PATCH",
        body: JSON.stringify({ draftMessageId: draft.id, body }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to save draft");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit draft message" onClose={onClose}>
      {draft === undefined ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      ) : draft === null ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This case has no un-sent draft to edit yet — drafts are generated once the orchestrator schedules an
          action.
        </p>
      ) : (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ReclassifyModal({
  caseId,
  onClose,
  onSaved,
}: {
  caseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [causeCode, setCauseCode] = useState<string>(CAUSE_CODES[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/approvals/${caseId}/reclassify`, {
        method: "POST",
        body: JSON.stringify({ causeCode }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to reclassify");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Reclassify case" onClose={onClose}>
      <select
        value={causeCode}
        onChange={(e) => setCauseCode(e.target.value)}
        className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        {CAUSE_CODES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {saving ? "Saving…" : "Reclassify"}
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
        {children}
      </div>
    </div>
  );
}
