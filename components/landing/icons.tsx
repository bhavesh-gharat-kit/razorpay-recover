/**
 * Landing-page icon set — stroke-based, 24×24, inherits `currentColor`.
 * Pure component (safe in server components). One consistent 1.6 stroke.
 */

type IconName =
  | "detect"
  | "diagnose"
  | "decide"
  | "draft"
  | "send"
  | "recover"
  | "cart"
  | "repeat"
  | "invoice"
  | "shield"
  | "gauge"
  | "clock"
  | "moon"
  | "hand"
  | "ledger"
  | "eye"
  | "sliders"
  | "download"
  | "trending"
  | "arrowRight"
  | "arrowUpRight"
  | "spark";

const PATHS: Record<IconName, React.ReactNode> = {
  detect: (
    <>
      <path d="M12 12 20 5" />
      <path d="M4 12a8 8 0 0 1 8-8" />
      <path d="M7 12a5 5 0 0 1 5-5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M5 18.5a9 9 0 0 0 14 0" opacity=".5" />
    </>
  ),
  diagnose: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.3-4.3" />
      <path d="M8.5 11h1.6l1 2 1.4-4 1 2h1.5" />
    </>
  ),
  decide: (
    <>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M6 8.2v7.6" />
      <path d="M6 12h6a3 3 0 0 1 3 3v.8" />
      <path d="M18 8V4m0 0-2 2m2-2 2 2" opacity=".6" />
    </>
  ),
  draft: (
    <>
      <path d="M4 20h16" />
      <path d="M14.5 4.5a2.1 2.1 0 0 1 3 3L8 17l-4 1 1-4Z" />
    </>
  ),
  send: (
    <>
      <path d="M4 12 20 4l-5 16-3.5-6.5L4 12Z" />
      <path d="m11.5 13.5 3-3" />
    </>
  ),
  recover: (
    <>
      <path d="M4 12a8 8 0 1 1 2.6 5.9" />
      <path d="M4 20v-3.5H7.5" />
      <path d="m9.5 12 2 2 3.5-4" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.78L20.5 8H6" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 3.5 20 6.5 17 9.5" />
      <path d="M20 6.5H8a4 4 0 0 0-4 4v.5" />
      <path d="M7 20.5 4 17.5 7 14.5" />
      <path d="M4 17.5h12a4 4 0 0 0 4-4v-.5" />
    </>
  ),
  invoice: (
    <>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6M9 8h2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6Z" />
      <path d="m9 12 2 2 4-4.5" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="m13 13-3-2" />
      <circle cx="12" cy="14" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  moon: (
    <>
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6.3 6.3 0 0 0 9.5 9.5Z" />
    </>
  ),
  hand: (
    <>
      <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 11V7a1.5 1.5 0 0 1 3 0v6a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4 13.4a1.6 1.6 0 0 1 2.6-1.8L8 13.5" />
    </>
  ),
  ledger: (
    <>
      <path d="M5 4h14v16H5Z" />
      <path d="M9 4v16" />
      <path d="M12 8.5h4M12 12h4M12 15.5h4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="10" cy="17" r="2.2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v11" />
      <path d="m7.5 10 4.5 4 4.5-4" />
      <path d="M5 20h14" />
    </>
  ),
  trending: (
    <>
      <path d="m3 16 5-5 4 4 8-9" />
      <path d="M16 6h5v5" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUpRight: <path d="M7 17 17 7M8 7h9v9" />,
  spark: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" opacity=".55" />
      <path d="M12 8c.6 2.2 1.8 3.4 4 4-2.2.6-3.4 1.8-4 4-.6-2.2-1.8-3.4-4-4 2.2-.6 3.4-1.8 4-4Z" />
    </>
  ),
};

export function Icon({
  name,
  size = 22,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
