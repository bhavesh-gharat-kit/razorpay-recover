"use client";

import { useRef, type ReactNode } from "react";

/**
 * Pointer-tracked 3D tilt. The signature effect on the landing page —
 * used for the example "case file". Children marked with data-depth get a
 * parallax push via the --lp-tilt-* CSS vars set here. Touch / reduced-motion
 * devices get a static card.
 */
export function TiltCard({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const raf = useRef<number | null>(null);

  function onMove(e: React.PointerEvent) {
    if (e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--lp-tilt-x", `${(-py * max).toFixed(2)}deg`);
      el.style.setProperty("--lp-tilt-y", `${(px * max).toFixed(2)}deg`);
      el.style.setProperty("--lp-tilt-mx", `${(px * 16).toFixed(1)}px`);
      el.style.setProperty("--lp-tilt-my", `${(py * 16).toFixed(1)}px`);
      el.style.setProperty("--lp-glow-x", `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty("--lp-glow-y", `${((py + 0.5) * 100).toFixed(1)}%`);
    });
  }

  function reset() {
    const el = ref.current;
    if (!el) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    el.style.setProperty("--lp-tilt-x", "0deg");
    el.style.setProperty("--lp-tilt-y", "0deg");
    el.style.setProperty("--lp-tilt-mx", "0px");
    el.style.setProperty("--lp-tilt-my", "0px");
  }

  return (
    <div
      ref={ref}
      className={`lp-tilt ${className}`}
      onPointerMove={onMove}
      onPointerLeave={reset}
    >
      {children}
    </div>
  );
}
