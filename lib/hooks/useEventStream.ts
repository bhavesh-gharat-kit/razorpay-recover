"use client";

/**
 * Client-side hook for the SSE endpoint (`/api/events/stream`, Phase 8).
 * Manages a single `EventSource`, tracks a connection status the
 * dashboard's connection dot renders, and hands every parsed event to the
 * caller's `onEvent` callback.
 *
 * Reconnection is manual (not the browser's built-in retry) so we can
 * surface a "reconnecting" state distinct from "connected" — the browser's
 * automatic retry gives no such signal.
 */

import { useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export type SystemEventType = "case_transition" | "batch_summary" | "recovery_detected";

export interface CaseTransitionEvent {
  type: "case_transition";
  data: { caseId: string; fromState: string | null; toState: string; causeCode: string | null };
}
export interface BatchSummaryEvent {
  type: "batch_summary";
  data: { processed: number; classified: number; scheduled: number; sent: number; recovered: number };
}
export interface RecoveryDetectedEvent {
  type: "recovery_detected";
  data: { caseId: string; amountPaise: number };
}

export type SystemEventMessage = CaseTransitionEvent | BatchSummaryEvent | RecoveryDetectedEvent;

const EVENT_TYPES: SystemEventType[] = ["case_transition", "batch_summary", "recovery_detected"];
const RECONNECT_DELAY_MS = 3000;

export function useEventStream(onEvent: (msg: SystemEventMessage) => void): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      es = new EventSource("/api/events/stream");

      es.addEventListener("connected", () => setStatus("connected"));

      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (evt) => {
          setStatus("connected");
          const raw = (evt as MessageEvent).data;
          try {
            const data = JSON.parse(raw);
            onEventRef.current({ type, data } as SystemEventMessage);
          } catch {
            // Malformed payload — ignore rather than crash the stream.
          }
        });
      }

      es.onerror = () => {
        // readyState === CLOSED means the browser gave up on this
        // connection for good (e.g. a 401/403 on the initial request) and
        // won't retry itself — surface that as "disconnected" rather than
        // looping forever against an endpoint that will never succeed.
        const isFatal = es?.readyState === EventSource.CLOSED;
        es?.close();
        if (isFatal) {
          setStatus("disconnected");
          return;
        }
        setStatus("reconnecting");
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  return status;
}
