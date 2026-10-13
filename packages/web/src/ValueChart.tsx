import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact, fmtPln } from "./format.ts";
import { ChartBusy, ChartPlaceholder } from "./Placeholders.tsx";
import { chartMargin, narrowYAxis, useNarrow } from "./useNarrow.ts";

export interface ValuePoint {
  date: string;
  value: number;
  cost: number;
}

/**
 * Value (area) and what was paid (dashed) over time, in PLN. Fills its parent's height unless `height` is given.
 * Until the first data arrives (`loading`), a placeholder of the same size; reloading (a new range), dimmed with a spinner.
 */
export function ValueChart({ data, testId, height, loading = false }: { data: ValuePoint[]; testId: string; height?: number; loading?: boolean }) {
  const narrow = useNarrow();
  if (data.length === 0) return <ChartPlaceholder loading={loading} height={height ?? "100%"}>No valuation history in this range.</ChartPlaceholder>;
  const gradient = `val-${testId}`;
  return (
    <div className="chart-frame" data-testid={testId} style={{ width: "100%", height: height ?? "100%" }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={chartMargin(narrow)}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
          <YAxis {...(narrow ? narrowYAxis : { width: 80, tick: { fontSize: 11 } })} stroke="var(--muted)" domain={["auto", "auto"]} tickFormatter={(v: number) => (narrow ? fmtCompact(v) : Math.round(v).toLocaleString("pl-PL"))} />
          <Tooltip
            formatter={(v, name) => [fmtPln(Number(v)), name === "value" ? "Value" : "Cost"]}
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}
          />
          <Area type="monotone" dataKey="cost" stroke="var(--muted)" strokeDasharray="4 3" fill="none" dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="value" stroke="var(--accent)" fill={`url(#${gradient})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <ChartBusy busy={loading} />
    </div>
  );
}
