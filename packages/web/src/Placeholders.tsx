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

/** A chart's box while loading (skeleton) or when there's nothing to draw (message), at the chart's height. */
export function ChartPlaceholder({ loading, height, children }: { loading: boolean; height: number | string; children: ReactNode }) {
  if (loading) return <Skeleton height={height} testId="chart-skeleton" />;
  return (
    <div className="chart-message muted" style={{ height }}>
      {children}
    </div>
  );
}
