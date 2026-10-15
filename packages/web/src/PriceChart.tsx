import { CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum } from "./format.ts";
import { ChartBusy, ChartPlaceholder } from "./Placeholders.tsx";
import { chartMargin, narrowYAxis, useNarrow } from "./useNarrow.ts";
import type { Price, Transaction } from "./types.ts";

/**
 * Market close (bonds: % of nominal; others in `unit`, e.g. EUR), or for retail bonds (`calculated`) the value per bond in PLN
 * (nominal 100). Inflation-linked bonds also get their indexed nominal per bond (PLN) as a dashed line on a right-hand axis. Fills its parent's height unless `height` is given; until the first data arrives (`loading`), a placeholder.
 */
export function PriceChart({
  prices,
  transactions,
  calculated = false,
  unit = "%",
  height,
  loading = false,
}: {
  prices: Price[];
  transactions: Transaction[];
  calculated?: boolean;
  unit?: string;
  height?: number;
  loading?: boolean;
}) {
  const narrow = useNarrow();
  if (prices.length === 0) return <ChartPlaceholder loading={loading} height={height ?? "100%"}>No prices in this range.</ChartPlaceholder>;
  const data = prices.map((p) => ({ date: p.date, close: p.close, traded: p.traded, volume: p.volume, nominal: p.nominal ?? null }));
  const withNominal = data.some((d) => d.nominal !== null);
  const byDate = new Map(data.map((d) => [d.date, d.close]));
  // Buys/sells shown on the price line at their date (or the next available session).
  const markers = transactions
    .filter((t) => (t.type === "BUY" || t.type === "SELL") && t.date >= prices[0]!.date && t.date <= prices.at(-1)!.date)
    .map((t) => {
      const date = byDate.has(t.date) ? t.date : data.find((d) => d.date >= t.date)?.date;
      return date ? { date, y: byDate.get(date)!, type: t.type, label: `${t.type} ${t.quantity ?? ""} @ ${t.price ?? "–"}` } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return (
    <div className="chart-frame" data-testid="price-chart" style={{ width: "100%", height: height ?? "100%" }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={chartMargin(narrow)}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
          <YAxis yAxisId="price" {...(narrow ? narrowYAxis : { width: 60, tick: { fontSize: 11 } })} stroke="var(--muted)" domain={["auto", "auto"]} tickFormatter={(v: number) => fmtNum(v, 1)} />
          {withNominal && (
            <YAxis yAxisId="nominal" orientation="right" {...(narrow ? narrowYAxis : { width: 60, tick: { fontSize: 11 } })} stroke="var(--muted)" domain={["auto", "auto"]} tickFormatter={(v: number) => fmtNum(v, 0)} />
          )}
          <Tooltip
            formatter={(v, name, item) =>
              name === "nominal"
                ? [`${fmtNum(Number(v))} PLN`, "Nominal"]
                : calculated
                ? [`${fmtNum(Number(v))} PLN`, "Value per bond"]
                : [`${fmtNum(Number(v))} ${unit}${(item?.payload as { traded?: boolean } | undefined)?.traded === false ? " (no trades)" : ""}`, "Close"]
            }
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}
          />
          <Line yAxisId="price" type="linear" dataKey="close" stroke="var(--accent)" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          {withNominal && (
            <Line yAxisId="nominal" type="linear" dataKey="nominal" stroke="var(--muted)" strokeDasharray="4 3" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
          )}
          {markers.map((m, i) => (
            <ReferenceDot key={i} yAxisId="price" x={m.date} y={m.y} r={5} fill={m.type === "BUY" ? "var(--pos)" : "var(--neg)"} stroke="var(--bg)" label={{ value: m.type, position: "top", fontSize: 10 }} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <ChartBusy busy={loading} />
    </div>
  );
}
