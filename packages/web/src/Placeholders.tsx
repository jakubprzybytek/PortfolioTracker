import type { ReactNode } from "react";

// Placeholders that hold the space of what's still loading (or turned out empty), so the page doesn't jump when it arrives.

/** A grey, gently pulsing block of the given height (a chart, a list). */
export function Skeleton({ height, testId = "skeleton" }: { height: number | string; testId?: string }) {
  return <div className="skeleton" style={{ height }} role="status" aria-label="Loading" data-testid={testId} />;
}

/** Table rows of grey bars, one per cell, while the table's data loads. */
export function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <tr key={i} className="skeleton-row" aria-hidden data-testid="skeleton-row">
          {Array.from({ length: cols }, (_, j) => (
            <td key={j}>
              <span className="skeleton-bar" style={{ width: j === 0 ? "70%" : "55%" }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Outline of a rising line over grid lines, in the page's colours, with a light sweeping across. */
const SILHOUETTE = "M0 82 C 30 80, 45 66, 80 68 S 130 52, 165 56 S 215 40, 250 44 S 300 26, 335 30 S 380 14, 400 12";

export function ChartSkeleton({ height }: { height: number | string }) {
  return (
    <div className="chart-skeleton" style={{ height }} role="status" aria-label="Loading the chart" data-testid="chart-skeleton">
      <svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden>
        <path d={`${SILHOUETTE} L400 100 L0 100 Z`} className="area" />
        <path d={SILHOUETTE} className="line" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** Over a chart that is reloading (a new range): dims it and shows a spinner, keeping its size. */
export function ChartBusy({ busy }: { busy: boolean }) {
  return busy ? (
    <div className="chart-busy" role="status" aria-label="Loading" data-testid="chart-busy">
      <span className="spinner" />
    </div>
  ) : null;
}

/** A chart's box while loading (skeleton) or when there's nothing to draw (message), at the chart's height. */
export function ChartPlaceholder({ loading, height, children }: { loading: boolean; height: number | string; children: ReactNode }) {
  if (loading) return <ChartSkeleton height={height} />;
  return (
    <div className="chart-message muted" style={{ height }}>
      {children}
    </div>
  );
}
