import type { ConnectionStatus } from "@/lib/hooks/useEventStream";

const LABEL: Record<ConnectionStatus, string> = {
  connected: "Live",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
};

const COLOR: Record<ConnectionStatus, string> = {
  connected: "bg-green-500",
  connecting: "bg-amber-500",
  reconnecting: "bg-amber-500",
  disconnected: "bg-red-500",
};

/** Small dot + label the demo operator watches to confirm SSE is alive. */
export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span
        className={`h-2 w-2 rounded-full ${COLOR[status]} ${status !== "connected" ? "animate-pulse" : ""}`}
      />
      {LABEL[status]}
    </span>
  );
}
