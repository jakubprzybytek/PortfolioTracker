import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtPln } from "./format.ts";
import type { HistoryPoint } from "./types.ts";

export function PortfolioChart({ history }: { history: HistoryPoint[] }) {
  const data = history.map((h) => ({ date: h.date, value: h.totals.value, cost: h.totals.cost }));
  if (data.length === 0) return <p className="muted">No valuation history in this range.</p>;
  return (
    <div data-testid="portfolio-chart" style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="val" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
          <YAxis tick={{ fontSize: 11 }} width={80} stroke="var(--muted)" domain={["auto", "auto"]} tickFormatter={(v: number) => Math.round(v).toLocaleString("pl-PL")} />
          <Tooltip
            formatter={(v, name) => [fmtPln(Number(v)), name === "value" ? "Value" : "Cost"]}
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}
          />
          <Area type="monotone" dataKey="cost" stroke="var(--muted)" strokeDasharray="4 3" fill="none" dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="value" stroke="var(--accent)" fill="url(#val)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
