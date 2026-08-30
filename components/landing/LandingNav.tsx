"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#situations", label: "What it handles" },
  { href: "#guardrails", label: "Guardrails" },
  { href: "#reviewers", label: "For reviewers" },
];

/**
 * Sticky landing nav — gains a backdrop + shrinks past the hero, and drives
 * a thin scroll-progress bar along the top edge.
 */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Smooth anchor scrolling, scoped to while the landing page is mounted.
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      root.style.scrollBehavior = "smooth";
    }

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        setScrolled(y > 40);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, y / max) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      root.style.scrollBehavior = prev;
    };
  }, []);

  return (
    <>
      <div className="lp-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <nav className={`lp-nav ${scrolled ? "is-scrolled" : ""}`}>
        <div className="lp-nav-inner">
          <Link href="/" className="lp-wordmark">
            <span className="lp-wordmark-mark" aria-hidden="true">
              <span />
            </span>
            Recover
          </Link>
          <div className="lp-nav-links">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href}>
                {l.label}
              </a>
            ))}
          </div>
          <Link href="/login" className="lp-btn lp-btn-primary lp-nav-cta">
            Log in
          </Link>
        </div>
      </nav>
    </>
  );
}
