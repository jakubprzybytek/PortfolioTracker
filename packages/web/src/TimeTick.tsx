// The charts' time axis drawn (timeAxis.ts): a tick's label, the year's start stronger; a line across the chart where
// a year starts.
import { ReferenceLine } from "recharts";
import type { TimeAxis } from "./timeAxis.ts";

/** An X axis tick: "Feb", "3 Nov", or the year ("2026") in the text's colour and bold. */
export function TimeTick({ x, y, payload, axis }: { x?: number | string; y?: number | string; payload?: { value: string }; axis: TimeAxis }) {
  const d = payload?.value ?? "";
  const year = axis.isYearStart(d);
  return (
    <text x={x} y={y} dy={14} textAnchor="middle" fontSize={12} fill={year ? "var(--fg)" : "var(--muted)"} fontWeight={year ? 600 : 400}>
      {axis.format(d)}
    </text>
  );
}

/** The props of a date XAxis (`dataKey="date"`): the ticks given, each one shown. */
export const timeAxisProps = (axis: TimeAxis) => ({ ticks: axis.ticks, interval: 0 as const, tick: (p: { x?: number | string; y?: number | string; payload?: { value: string } }) => <TimeTick {...p} axis={axis} /> });

/** A solid line across the chart where each year starts (`yAxisId`: the chart's Y axis, when it names its axes). */
export function yearLines(axis: TimeAxis, yAxisId?: string) {
  return axis.yearStarts.map((d) => <ReferenceLine key={d} x={d} {...(yAxisId ? { yAxisId } : {})} stroke="var(--muted)" strokeOpacity={0.55} ifOverflow="hidden" />);
}
