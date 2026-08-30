"use client";

import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastProps {
  message: string;
  type?: ToastType;
  /** Auto-dismiss after this many ms. Default 3000. */
  duration?: number;
  onDismiss: () => void;
}

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✗",
  info: "ℹ",
};

const STYLE: Record<ToastType, string> = {
  success:
    "border-green-300 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/40 dark:text-green-200",
  error:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200",
  info: "border-slate-300 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

export function Toast({ message, type = "success", duration = 3000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200); // wait for fade-out
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      className={`fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      } ${STYLE[type]}`}
    >
      <span className="text-base" aria-hidden>
        {ICONS[type]}
      </span>
      {message}
    </div>
  );
}
