import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ASSET_CLASSES, drawdowns } from "@portfolio/core/valuation/history";
import { CLASS_COLORS, CLASS_LABELS } from "./Allocation.tsx";
import { fmtNum, fmtPct, fmtPln } from "./format.ts";
import { ChartBusy, ChartPlaceholder } from "./Placeholders.tsx";
import type { HistoryPoint } from "./types.ts";
import { chartMargin, narrowYAxis, useNarrow } from "./useNarrow.ts";

/** Keeps "−2 %" on one line: recharts wraps axis labels at spaces, and on a phone the axis is 1 px wide. */
const NBSP = " ";
const tooltipStyle = { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 };
const yAxis = (narrow: boolean) => (narrow ? narrowYAxis : { width: 56, tick: { fontSize: 11 } });

/**
 * How far below its best so far the portfolio was each day (%), on the time-weighted return, so deposits and
 * withdrawals don't count (`drawdowns` in core). The best counts from the start of the range shown.
 */
export function DrawdownChart({ history, loading, height = 200 }: { history: HistoryPoint[]; loading: boolean; height?: number }) {
  const narrow = useNarrow();
  const points = history.filter((h) => h.total !== undefined && h.netDeposits !== undefined);
  if (points.length === 0) return <ChartPlaceholder loading={loading} height={height}>No valuation history in this range.</ChartPlaceholder>;
  const data = drawdowns(points.map((h) => ({ date: h.date, total: h.total!, netDeposits: h.netDeposits! }))).map((d) => ({ date: d.date, drawdown: d.drawdown * 100 }));
  const worst = Math.min(...data.map((d) => d.drawdown));
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => s * 4 >= -worst) ?? 25;
  const ticks = Array.from({ length: Math.max(1, Math.ceil(-worst / step)) + 1 }, (_, i) => (i ? -i * step : 0));
  return (
    <div className="chart-frame" data-testid="drawdown-chart" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={chartMargin(narrow)}>
          <defs>
            <linearGradient id="drawdown-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--neg)" stopOpacity={0.05} />
              <stop offset="100%" stopColor="var(--neg)" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
          <YAxis {...yAxis(narrow)} stroke="var(--muted)" domain={[ticks.at(-1)!, 0]} ticks={ticks} interval={0} tickFormatter={(v: number) => `${fmtNum(v, step < 1 ? 1 : 0)}${NBSP}%`} />
          <Tooltip formatter={(v) => [fmtPct(Number(v)), "Below the best so far"]} contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="drawdown" baseValue={0} stroke="var(--neg)" fill="url(#drawdown-fill)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <ChartBusy busy={loading} />
    </div>
  );
}

/** Shares, bonds, cash and other as % of positions + cash each day (stacked to 100 %); the tooltip adds the amounts. */
export function AllocationChart({ history, loading, height = 220 }: { history: HistoryPoint[]; loading: boolean; height?: number }) {
  const narrow = useNarrow();
  const data = history.flatMap((h) => {
    const c = h.byClass;
    const total = c ? ASSET_CLASSES.reduce((s, k) => s + Math.max(0, c[k]), 0) : 0;
    if (!c || total <= 0) return [];
    return [{ date: h.date, ...Object.fromEntries(ASSET_CLASSES.flatMap((k) => [[k, (Math.max(0, c[k]) / total) * 100], [`${k}_pln`, c[k]]])) } as Record<string, number | string>];
  });
  if (data.length === 0) return <ChartPlaceholder loading={loading} height={height}>No valuation history in this range.</ChartPlaceholder>;
  // Only the classes held at some point in the range.
  const classes = ASSET_CLASSES.filter((k) => data.some((d) => (d[k] as number) > 0));
  return (
    <div className="chart-frame" data-testid="allocation-chart" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={chartMargin(narrow)}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
          <YAxis {...yAxis(narrow)} stroke="var(--muted)" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} interval={0} allowDataOverflow tickFormatter={(v: number) => `${v}${NBSP}%`} />
          <Tooltip
            formatter={(v, name, item) => [`${fmtNum(Number(v), 1)} %  ·  ${fmtPln(Number((item.payload as Record<string, number>)[`${String(name)}_pln`]))}`, CLASS_LABELS[name as keyof typeof CLASS_LABELS]]}
            itemSorter={() => 0}
            contentStyle={tooltipStyle}
          />
          {classes.map((k) => (
            <Area key={k} type="monotone" dataKey={k} stackId="mix" stroke={CLASS_COLORS[k]} fill={CLASS_COLORS[k]} fillOpacity={0.55} dot={false} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      <ChartBusy busy={loading} />
    </div>
  );
}
