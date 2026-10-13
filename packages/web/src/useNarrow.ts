import { useEffect, useState } from "react";

/** Same breakpoint as the stylesheet's mobile layout (menu on top). */
const QUERY = "(max-width: 720px)";

/** True on a phone-sized screen; follows rotation and window resizes. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const m = window.matchMedia(QUERY);
    const onChange = () => setNarrow(m.matches);
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Chart margins: on a phone the plot reaches the screen edges. */
export const chartMargin = (narrow: boolean) => (narrow ? { top: 16, right: 0, left: 0, bottom: 0 } : { top: 8, right: 16, left: 8, bottom: 0 });

/** Y axis on a phone: no column of its own; the labels sit inside the plot, just above their grid lines. */
export const narrowYAxis = { mirror: true, width: 1, axisLine: false, tickLine: false, tick: { fontSize: 10, dy: -7 } } as const;
