"use client";

import { useState } from "react";
import type { TimelineEntry } from "@/lib/audit/timeline";
import { relativeTime } from "@/lib/format/relativeTime";

/** Vertical audit timeline — case detail page and the standalone Audit page both use this. */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No audit entries yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-4 dark:border-slate-700">
      {entries.map((entry, i) => (
        <TimelineRow key={i} entry={entry} />
      ))}
    </ol>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail =
    entry.metadata != null || entry.beforeState != null || entry.afterState != null;

  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-slate-400 dark:bg-slate-500" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span aria-hidden className="text-sm">
          {entry.actor === "SYSTEM" ? "🤖" : "👤"}
        </span>
        <span className="text-sm text-slate-800 dark:text-slate-200">{entry.description}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {relativeTime(entry.createdAt)}
        </span>
        {entry.actorEmail && (
          <span className="text-xs text-slate-400 dark:text-slate-500">by {entry.actorEmail}</span>
        )}
      </div>
      {hasDetail && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && hasDetail && (
        <pre className="mt-1 max-w-full overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {JSON.stringify(
            { metadata: entry.metadata, before: entry.beforeState, after: entry.afterState },
            null,
            2,
          )}
        </pre>
      )}
    </li>
  );
}
