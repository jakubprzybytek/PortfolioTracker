import { useEffect, useState } from "react";

/** Same breakpoint as the stylesheet's mobile layout (menu on top). */
const QUERY = "(max-width: 720px)";

/** True on a phone-sized screen; follows rotation and window resizes. */
export function useNarrow(): boolean {
  return useMedia(QUERY);
}

/** Whether a media query matches now; follows rotation and window resizes. */
export function useMedia(query: string): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const onChange = () => setNarrow(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

/** Chart margins: on a phone the plot reaches the screen edges. */
export const chartMargin = (narrow: boolean) => (narrow ? { top: 16, right: 0, left: 0, bottom: 0 } : { top: 8, right: 16, left: 8, bottom: 0 });

/** Y axis on a phone: no column of its own; the labels sit inside the plot, just above their grid lines. */
export const narrowYAxis = { mirror: true, width: 1, axisLine: false, tickLine: false, tick: { fontSize: 10, dy: -7 } } as const;

/**
 * Y axis of an amount chart (value, cost): 5–7 round ticks with the lowest one labelled, so the bottom of the plot
 * reads as a value, not as zero. It starts at 0 when the line falls below half its peak (a big loss shows as one), and
 * otherwise just below the lowest point, so the line never lies on the floor.
 */
export function amountAxis(values: number[]): { domain: [number, number]; ticks: number[] } {
  const v = values.filter((x) => Number.isFinite(x));
  const max = v.length ? Math.max(...v) : 0;
  const min = v.length ? Math.min(...v) : 0;
  if (max === 0 && min === 0) return { domain: [0, 1], ticks: [0, 1] };
  let low = min >= 0 && min < max / 2 ? 0 : min - (max - min) * 0.05;
  let high = max + (max - min) * 0.05;
  if (high === low) [low, high] = [low - Math.abs(low || 1) * 0.1, high + Math.abs(high || 1) * 0.1];
  const raw = (high - low) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const from = Math.floor(low / step) * step;
  const to = Math.ceil(high / step) * step;
  const ticks: number[] = [];
  for (let t = from; t <= to + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { domain: [from, to], ticks };
}
