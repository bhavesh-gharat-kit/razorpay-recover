import type { CaseState } from "@prisma/client";

/**
 * Color-coded pill for a Case's state. Colors per the Phase 8 spec: green
 * for RECOVERED, red for ESCALATED, blue for ACTION_SENT, amber for
 * DIAGNOSED, gray for CLOSED/ABANDONED. DETECTED and ACTION_SCHEDULED
 * aren't specified there — given slate/indigo so every state is visually
 * distinct in the Case Explorer table.
 */
const STYLES: Record<CaseState, string> = {
  DETECTED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  DIAGNOSED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  ACTION_SCHEDULED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  ACTION_SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  RECOVERED: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ESCALATED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  ABANDONED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  CLOSED: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function StateBadge({ state }: { state: CaseState | string }) {
  const style = STYLES[state as CaseState] ?? STYLES.DETECTED;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {state}
    </span>
  );
}
