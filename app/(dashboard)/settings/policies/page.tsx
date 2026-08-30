"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecoveryPolicy } from "@prisma/client";
import { apiFetch, ApiRequestError } from "@/lib/api/client";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { Toast } from "@/components/Toast";

type EditableFields = Pick<
  RecoveryPolicy,
  "cooldownMinutes" | "maxAttempts" | "sendWindowStartHour" | "sendWindowEndHour" | "active"
>;

export default function PoliciesPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [policies, setPolicies] = useState<RecoveryPolicy[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EditableFields>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<{ items: RecoveryPolicy[] }>("/api/policies");
      setPolicies(data.items);
      setDrafts(
        Object.fromEntries(
          data.items.map((p) => [
            p.id,
            {
              cooldownMinutes: p.cooldownMinutes,
              maxAttempts: p.maxAttempts,
              sendWindowStartHour: p.sendWindowStartHour,
              sendWindowEndHour: p.sendWindowEndHour,
              active: p.active,
            },
          ]),
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!userLoading && user && user.role !== "ADMIN") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        You don&apos;t have permission to view policy settings. ADMIN access required.
      </div>
    );
  }

  function updateDraft(id: string, patch: Partial<EditableFields>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  function isDirty(p: RecoveryPolicy): boolean {
    const d = drafts[p.id];
    if (!d) return false;
    return (
      d.cooldownMinutes !== p.cooldownMinutes ||
      d.maxAttempts !== p.maxAttempts ||
      d.sendWindowStartHour !== p.sendWindowStartHour ||
      d.sendWindowEndHour !== p.sendWindowEndHour ||
      d.active !== p.active
    );
  }

  async function save(p: RecoveryPolicy) {
    setSavingId(p.id);
    setError(null);
    try {
      await apiFetch(`/api/policies/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify(drafts[p.id]),
      });
      setToast({ message: "Policy saved successfully.", type: "success" });
      await load();
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : "Failed to save policy";
      setError(msg);
      setToast({ message: msg, type: "error" });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Recovery policies</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Guardrails per cause code — cooldown between attempts, attempt cap, and the IST hours outreach is
          allowed to send. Changes take effect on the next orchestrator tick.
        </p>
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
              <th className="px-3 py-2">Scenario / Cause</th>
              <th className="px-3 py-2">Cooldown (min)</th>
              <th className="px-3 py-2">Max attempts</th>
              <th className="px-3 py-2">Send window (IST)</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : (
              policies.map((p, i) => {
                const d = drafts[p.id];
                if (!d) return null;
                const dirty = isDirty(p);
                return (
                  <tr
                    key={p.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                      i % 2 === 1 ? "bg-slate-50/50 dark:bg-slate-900/40" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800 dark:text-slate-200">
                        {p.causeCode}
                        {p.escalationTier != null && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                            Tier {p.escalationTier}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        {p.scenario} · {(p.allowedActions as string[]).join(", ")}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        value={d.cooldownMinutes}
                        onChange={(v) => updateDraft(p.id, { cooldownMinutes: v })}
                        min={0}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput
                        value={d.maxAttempts}
                        onChange={(v) => updateDraft(p.id, { maxAttempts: v })}
                        min={1}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <NumberInput
                          value={d.sendWindowStartHour}
                          onChange={(v) => updateDraft(p.id, { sendWindowStartHour: v })}
                          min={0}
                          max={23}
                          className="w-14"
                        />
                        <span className="text-slate-400">–</span>
                        <NumberInput
                          value={d.sendWindowEndHour}
                          onChange={(v) => updateDraft(p.id, { sendWindowEndHour: v })}
                          min={0}
                          max={23}
                          className="w-14"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <button
                        role="switch"
                        aria-checked={d.active}
                        onClick={() => updateDraft(p.id, { active: !d.active })}
                        className={`h-5 w-9 rounded-full transition-colors ${
                          d.active ? "bg-green-500" : "bg-slate-300 dark:bg-slate-600"
                        }`}
                      >
                        <span
                          className={`block h-4 w-4 translate-x-0.5 rounded-full bg-white transition-transform ${
                            d.active ? "translate-x-4" : ""
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      {dirty && (
                        <button
                          onClick={() => save(p)}
                          disabled={savingId === p.id}
                          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                        >
                          {savingId === p.id ? "Saving…" : "Save"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
            {!loading && policies.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-slate-400">
                  No policies configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`w-20 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 ${className ?? ""}`}
    />
  );
}
