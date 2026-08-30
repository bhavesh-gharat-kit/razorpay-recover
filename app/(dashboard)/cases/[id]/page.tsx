"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CaseState, Channel, DeliveryStatus, GeneratedBy, Language } from "@prisma/client";
import type { TimelineEntry } from "@/lib/audit/timeline";
import { apiFetch, ApiRequestError } from "@/lib/api/client";
import { formatAmountINR } from "@/lib/messaging/formatAmount";
import { relativeTime } from "@/lib/format/relativeTime";
import { StateBadge } from "@/components/StateBadge";
import { ScenarioBadge } from "@/components/ScenarioBadge";
import { Timeline } from "@/components/Timeline";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { Toast } from "@/components/Toast";

interface CaseDetail {
  id: string;
  state: CaseState;
  attemptCount: number;
  maxAttempts: number;
  recoveredAmountPaise: number | null;
  recoveryLinkId: string | null;
  recoveryLinkUrl: string | null;
  promisedPaymentDate: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { name: string; email: string; phone: string };
  merchant: { name: string };
  classifiedCase: { causeCode: string; confidence: number; source: string } | null;
  recoveryEvent: {
    amountPaise: number;
    currency: string;
    scenario: string;
    razorpayRefId: string | null;
    sourceType: string;
    occurredAt: string;
    dueDate: string | null;
    rawPayload: unknown;
  };
  draftMessages: DraftMessageDetail[];
}

/** Days between dueDate and now, floored at 0 — mirrors
 * getDaysOverdue() in lib/orchestrator/orchestrator.ts. */
function daysOverdue(dueDate: string): number {
  const diffMs = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/** Mirrors getEscalationTier() in lib/orchestrator/orchestrator.ts. */
function escalationTier(days: number): 1 | 2 | 3 {
  if (days <= 3) return 1;
  if (days <= 10) return 2;
  return 3;
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "Tier 1 — Friendly nudge",
  2: "Tier 2 — Firm reminder",
  3: "Tier 3 — Escalated to human",
};

/** Best-effort read of the subscription entity Phase 9's ingestion
 * handlers embed in rawPayload — see lib/ingestion/handlers/subscription-*.ts. */
function readSubscriptionEntity(rawPayload: unknown): Record<string, unknown> | null {
  try {
    const p = rawPayload as Record<string, unknown>;
    const inner = p?.payload as Record<string, unknown> | undefined;
    const sub = inner?.subscription as Record<string, unknown> | undefined;
    const entity = sub?.entity as Record<string, unknown> | undefined;
    return entity ?? null;
  } catch {
    return null;
  }
}

interface DraftMessageDetail {
  id: string;
  channel: Channel;
  language: Language;
  subject: string | null;
  body: string;
  generatedBy: GeneratedBy;
  promptVersion: string | null;
  createdAt: string;
  deliveryAttempts: {
    id: string;
    status: DeliveryStatus;
    providerRef: string | null;
    errorDetail: string | null;
    createdAt: string;
  }[];
}

const TERMINAL_STATES: CaseState[] = ["RECOVERED", "CLOSED"];

export default function CaseDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { user } = useCurrentUser();

  const [data, setData] = useState<CaseDetail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRecoverModal, setShowRecoverModal] = useState(false);
  const [showPromiseModal, setShowPromiseModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const canAct = user?.role === "ADMIN" || user?.role === "REVIEWER";

  const load = useCallback(async () => {
    try {
      const [caseData, auditData] = await Promise.all([
        apiFetch<{ case: CaseDetail }>(`/api/cases/${id}`),
        apiFetch<{ entries: TimelineEntry[] }>(`/api/audit?caseId=${id}`),
      ]);
      setData(caseData.case);
      setTimeline(auditData.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to load case");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const ACTION_TOAST: Record<string, string> = {
    approve: "Case approved — orchestrator will resume.",
    reject: "Case rejected and closed.",
    "mark-recovered": "Case marked as recovered.",
    retry: "Retry send queued.",
    "promise-to-pay": "Promise to pay logged.",
  };

  async function runAction(name: string, fn: () => Promise<unknown>) {
    setActionBusy(name);
    setActionError(null);
    try {
      await fn();
      setToast({ message: ACTION_TOAST[name] ?? `${name} completed.`, type: "success" });
      // Brief delay so the database state has time to settle before reload
      await new Promise((r) => setTimeout(r, 500));
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : `${name} failed`;
      setActionError(msg);
      setToast({ message: msg, type: "error" });
    } finally {
      setActionBusy(null);
    }
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />;
  }
  if (error || !data) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
        {error ?? "Case not found."}
      </p>
    );
  }

  const isTerminal = TERMINAL_STATES.includes(data.state);
  const lastDelivery = data.draftMessages
    .flatMap((d) => d.deliveryAttempts)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const canRetry =
    data.state === "ACTION_SCHEDULED" && Boolean(data.recoveryLinkUrl) && lastDelivery?.status === "FAILED";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/cases" className="text-sm text-slate-500 hover:underline dark:text-slate-400">
          ← Back to Cases
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{data.customer.name}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {data.customer.email} · {data.customer.phone}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <span>Merchant: {data.merchant.name}</span>
              <ScenarioBadge scenario={data.recoveryEvent.scenario} />
            </p>
            {data.promisedPaymentDate && (
              <p
                className={`mt-1 text-sm font-medium ${
                  new Date(data.promisedPaymentDate) > new Date()
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {new Date(data.promisedPaymentDate) > new Date() ? "⏸️ Paused until " : "⚠️ Promise expired "}
                {new Date(data.promisedPaymentDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
          <div className="text-right">
            <StateBadge state={data.state} />
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatAmountINR(data.recoveryEvent.amountPaise, data.recoveryEvent.currency)}
            </p>
            {data.recoveredAmountPaise != null && (
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                Recovered: {formatAmountINR(data.recoveredAmountPaise, data.recoveryEvent.currency)}
              </p>
            )}
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Field label="Cause code" value={data.classifiedCase?.causeCode ?? "Unclassified"} />
          <Field
            label="Confidence"
            value={data.classifiedCase ? `${(data.classifiedCase.confidence * 100).toFixed(0)}%` : "—"}
          />
          <Field label="Attempts" value={`${data.attemptCount}/${data.maxAttempts}`} />
          <Field label="Razorpay ref" value={data.recoveryEvent.razorpayRefId ?? "—"} />
          <Field
            label="Recovery link"
            value={
              data.recoveryLinkUrl ? (
                <a
                  href={data.recoveryLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  {data.recoveryLinkId}
                </a>
              ) : (
                "None yet"
              )
            }
          />
          <Field label="Created" value={relativeTime(data.createdAt)} />
          <Field label="Updated" value={relativeTime(data.updatedAt)} />
          <Field
            label="Export"
            value={
              <a
                href={`/api/audit/export?caseId=${id}&format=csv`}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                Download Audit Trail (CSV)
              </a>
            }
          />
        </dl>

        {data.recoveryEvent.scenario === "INVOICE_OVERDUE" && data.recoveryEvent.dueDate && (
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-4">
            <Field
              label="Due date"
              value={new Date(data.recoveryEvent.dueDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            />
            <Field label="Days overdue" value={String(daysOverdue(data.recoveryEvent.dueDate))} />
            <Field
              label="Escalation tier"
              value={TIER_LABEL[escalationTier(daysOverdue(data.recoveryEvent.dueDate))]}
            />
          </dl>
        )}

        {data.recoveryEvent.scenario === "SUBSCRIPTION_FAILURE" &&
          (() => {
            const sub = readSubscriptionEntity(data.recoveryEvent.rawPayload);
            if (!sub) return null;
            return (
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-4">
                <Field label="Subscription ID" value={String(sub.id ?? "—")} />
                <Field label="Mandate status" value={String(sub.status ?? "—")} />
              </dl>
            );
          })()}

        {canAct && !isTerminal && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            <ActionButton
              label="Approve"
              busy={actionBusy === "approve"}
              onClick={() =>
                runAction("approve", () => apiFetch(`/api/approvals/${id}/approve`, { method: "POST" }))
              }
              className="bg-green-600 hover:bg-green-700"
            />
            {data.recoveryEvent.scenario === "INVOICE_OVERDUE" && (
              <ActionButton
                label="Log Promise to Pay"
                busy={actionBusy === "promise-to-pay"}
                onClick={() => setShowPromiseModal(true)}
                className="bg-amber-600 hover:bg-amber-700"
              />
            )}
            <ActionButton
              label="Reject"
              busy={actionBusy === "reject"}
              onClick={() =>
                runAction("reject", () => apiFetch(`/api/approvals/${id}/reject`, { method: "POST" }))
              }
              className="bg-red-600 hover:bg-red-700"
            />
            <ActionButton
              label="Mark Recovered"
              busy={actionBusy === "mark-recovered"}
              onClick={() => setShowRecoverModal(true)}
              className="bg-slate-700 hover:bg-slate-800"
            />
            {canRetry && (
              <ActionButton
                label="Retry Send"
                busy={actionBusy === "retry"}
                onClick={() =>
                  runAction("retry", () => apiFetch(`/api/cases/${id}/retry-send`, { method: "POST" }))
                }
                className="bg-indigo-600 hover:bg-indigo-700"
              />
            )}
          </div>
        )}
        {!canAct && !isTerminal && (
          <p className="mt-4 border-t border-slate-100 pt-4 text-xs text-slate-400 dark:border-slate-800">
            Reviewer or Admin access required to act on this case.
          </p>
        )}
        {actionError && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {actionError}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Draft messages</h2>
        {data.draftMessages.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No drafts yet.</p>
        ) : (
          <div className="space-y-4">
            {data.draftMessages.map((d) => (
              <div key={d.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge>{d.channel}</Badge>
                  <Badge>{d.language}</Badge>
                  <Badge>{d.generatedBy}</Badge>
                  <span className="text-slate-400">{relativeTime(d.createdAt)}</span>
                </div>
                {d.subject && <p className="mb-1 text-sm font-medium text-slate-800 dark:text-slate-200">{d.subject}</p>}
                <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{d.body}</p>
                {d.deliveryAttempts.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
                    {d.deliveryAttempts.map((a) => (
                      <p key={a.id} className="text-xs text-slate-500 dark:text-slate-400">
                        {a.status === "SENT" || a.status === "DELIVERED" ? "✅" : "❌"} {a.status}
                        {a.providerRef ? ` · ref ${a.providerRef}` : ""}
                        {a.errorDetail ? ` · ${a.errorDetail}` : ""} · {relativeTime(a.createdAt)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Audit timeline</h2>
        <Timeline entries={timeline} />
      </div>

      {showRecoverModal && (
        <MarkRecoveredModal
          defaultAmount={data.recoveryEvent.amountPaise}
          currency={data.recoveryEvent.currency}
          busy={actionBusy === "mark-recovered"}
          onCancel={() => setShowRecoverModal(false)}
          onConfirm={(amount) => {
            setShowRecoverModal(false);
            runAction("mark-recovered", () =>
              apiFetch(`/api/approvals/${id}/mark-recovered`, {
                method: "POST",
                body: JSON.stringify({ recoveredAmountPaise: amount }),
              }),
            );
          }}
        />
      )}

      {showPromiseModal && (
        <PromiseToPayModal
          busy={actionBusy === "promise-to-pay"}
          onCancel={() => setShowPromiseModal(false)}
          onConfirm={(date) => {
            setShowPromiseModal(false);
            runAction("promise-to-pay", () =>
              apiFetch(`/api/cases/${id}/promise-to-pay`, {
                method: "POST",
                body: JSON.stringify({ promisedPaymentDate: date }),
              }),
            );
          }}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-slate-700 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

function ActionButton({
  label,
  onClick,
  busy,
  className,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  className: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${className}`}
    >
      {busy ? "…" : label}
    </button>
  );
}

function MarkRecoveredModal({
  defaultAmount,
  currency,
  busy,
  onCancel,
  onConfirm,
}: {
  defaultAmount: number;
  currency: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (amountPaise: number) => void;
}) {
  const [rupees, setRupees] = useState((defaultAmount / 100).toString());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Mark case recovered</h3>
        <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">
          Amount recovered ({currency})
        </label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={() => onConfirm(Math.round(parseFloat(rupees || "0") * 100))}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function PromiseToPayModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (isoDate: string) => void;
}) {
  const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [date, setDate] = useState(twoWeeksOut);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-200">Log promise to pay</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Escalation pauses until this date. If it passes with no payment, escalation resumes automatically on
          the next tick.
        </p>
        <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Expected payment date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-4 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300"
          >
            Cancel
          </button>
          <button
            disabled={busy || !date}
            onClick={() => onConfirm(date)}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
