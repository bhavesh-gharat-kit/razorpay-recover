"use client";

/**
 * Static fallback for the hero 3D scene — shown while the WebGL bundle is
 * loading (via next/dynamic), and permanently on reduced-motion / very
 * narrow screens where a big canvas would just cost battery.
 */

export function HeroSceneFallback() {
  return (
    <div className="lp-hero-3d lp-hero-3d-fallback" aria-hidden="true">
      <div className="lp-hero-3d-card">
        <div className="chip" />
        <div className="rows">
          <div className="row" />
          <div className="row short" />
        </div>
        <div className="number">4242 4242 4242 4242</div>
        <div className="brand">RECOVER</div>
      </div>
      <span className="orbit orbit-a">₹</span>
      <span className="orbit orbit-b">₹</span>
      <span className="orbit orbit-c">₹</span>
    </div>
  );
}
