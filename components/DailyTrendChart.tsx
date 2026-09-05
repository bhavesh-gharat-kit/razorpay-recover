import type { DailyTrendPoint } from "@/lib/analytics/summary";

/**
 * Minimal inline-SVG bar chart for the daily recovery trend — no charting
 * library, just computed `<rect>` elements per the phase spec.
 */
export function DailyTrendChart({ points }: { points: DailyTrendPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No trend data in this window yet.
      </p>
    );
  }

  const width = 640;
  const height = 160;
  const padding = 24;
  const barGap = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const barWidth = Math.max(2, chartWidth / points.length - barGap);

  const maxDetected = Math.max(1, ...points.map((p) => p.detected));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Daily detected vs recovered cases"
      className="w-full"
    >
      {points.map((p, i) => {
        const x = padding + i * (barWidth + barGap);
        const detectedH = (p.detected / maxDetected) * chartHeight;
        const recoveredH = (p.recovered / maxDetected) * chartHeight;
        return (
          <g key={p.date}>
            {/* "Detected" bars: previously fill-slate-700 in dark, which
                sat on top of the slate-900 card and vanished. Bumped to
                slate-500 so they stay visible even when nothing has been
                recovered yet. */}
            <rect
              x={x}
              y={height - padding - detectedH}
              width={barWidth}
              height={detectedH}
              rx={1.5}
              className="fill-slate-300 dark:fill-slate-500"
            >
              <title>{`${p.date}: ${p.detected} detected`}</title>
            </rect>
            <rect
              x={x}
              y={height - padding - recoveredH}
              width={barWidth}
              height={recoveredH}
              rx={1.5}
              className="fill-green-500"
            >
              <title>{`${p.date}: ${p.recovered} recovered`}</title>
            </rect>
          </g>
        );
      })}
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        className="stroke-slate-300 dark:stroke-slate-500"
        strokeWidth={1}
      />
    </svg>
  );
}
