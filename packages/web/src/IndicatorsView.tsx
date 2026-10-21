import { Fragment } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, fmtNum, today } from "./format.ts";
import { ChartBusy, ChartPlaceholder, SkeletonRows } from "./Placeholders.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { IndicatorPoint, IndicatorSummary } from "./types.ts";
import { useApi } from "./useApi.ts";
import { chartMargin, narrowYAxis, useNarrow } from "./useNarrow.ts";

/** Ranges in years; monthly indicators are filtered by month on the server. */
const RANGES = [
  { key: "1Y", years: 1 },
  { key: "5Y", years: 5 },
  { key: "10Y", years: 10 },
  { key: "ALL", years: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const digits = (i: Pick<IndicatorSummary, "unit">) => (i.unit === "%" ? 1 : i.unit === "PLN" ? 4 : 2);
const fmtValue = (i: Pick<IndicatorSummary, "unit">, v: number | undefined) =>
  v === undefined ? "–" : i.unit === "%" ? `${fmtNum(v, 1)} %` : fmtNum(v, digits(i));

/**
 * First date of the range. Monthly indicators lag by a month or two, so they count back from their latest month
 * (1Y = the last 12 months), yearly ones from their latest year (5Y = the last 5 years); daily ones from today.
 */
function rangeStart(years: number | null, i: IndicatorSummary | undefined): string {
  if (years === null) return "1980-01-01";
  if (i?.frequency === "yearly" && i.latest) return `${Number(i.latest.date) - years + 1}-01-01`;
  if (i?.frequency === "monthly" && i.latest) {
    const [y, m] = i.latest.date.split("-").map(Number) as [number, number];
    const k = y * 12 + (m - 1) - (years * 12 - 1);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
  }
  return addDays(today(), -Math.round(years * 365.25));
}

/** Economic indicators from the stored data: latest value, its date, a year earlier. Clicking a row shows its chart. */
export function IndicatorsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const rows = useApi<IndicatorSummary[]>("/indicators");
  const selected = params["chart"] ?? null;
  const range: RangeKey = RANGES.some((r) => r.key === params["range"]) ? (params["range"] as RangeKey) : "5Y";
  const years = RANGES.find((r) => r.key === range)!.years;
  const sel = rows.data?.find((i) => i.id === selected);
  const from = rangeStart(years, sel);
  const series = useApi<IndicatorPoint[]>(sel ? `/indicators/${sel.id}` : null, { from, to: today() });
  const groups = [...new Set((rows.data ?? []).map((i) => i.group))];

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Indicators</h2>
        <span className="muted">{rows.loading ? "Loading…" : ""}</span>
      </header>
      {rows.error && <p className="error">{rows.error}</p>}

      <div className="table-wrap">
        <table data-testid="indicators-table" className="static">
          <thead>
            <tr>
              <th className="left">Indicator</th>
              <th>Latest</th>
              <th>Date</th>
              <th>A year earlier</th>
            </tr>
          </thead>
          <tbody>
            {!rows.data && rows.loading && <SkeletonRows rows={6} cols={4} />}
            {groups.map((g) => (
              <Fragment key={g}>
                <tr className="group" data-testid={`indicator-group-${g}`}>
                  <td className="left" colSpan={4}>
                    {g}
                  </td>
                </tr>
                {(rows.data ?? [])
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <tr
                      key={i.id}
                      className={`clickable${i.id === selected ? " selected" : ""}`}
                      onClick={() => setParams({ ...params, chart: i.id === selected ? undefined : i.id })}
                      data-testid={`indicator-${i.id}`}
                      title={i.note}
                    >
                      <td className="left indent instrument">
                        <strong>{i.name}</strong>
                      </td>
                      <td>{fmtValue(i, i.latest?.value)}</td>
                      <td>{i.latest?.date ?? "no data"}</td>
                      <td className="muted" title={i.yearAgo?.date ?? ""}>
                        {fmtValue(i, i.yearAgo?.value)}
                      </td>
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {sel && (
        <>
          <h2 data-testid="indicator-title">
            {sel.name}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              · {sel.note}
            </span>
          </h2>
          <section className="panel">
            <RangePicker
              value={range}
              options={RANGES.map((r) => r.key)}
              onChange={(key) => setParams({ ...params, range: key === "5Y" ? undefined : key })}
              busy={series.loading}
              testId="indicator-range"
            />
            {series.error ? <p className="error">{series.error}</p> : <IndicatorChart indicator={sel} points={series.data ?? []} loading={series.loading} />}
          </section>
        </>
      )}
    </>
  );
}

/** Percent changes as bars around zero (rises in the accent colour, falls grey); levels (index, rates) as a line. */
function IndicatorChart({ indicator, points, loading }: { indicator: IndicatorSummary; points: IndicatorPoint[]; loading: boolean }) {
  const narrow = useNarrow();
  if (points.length === 0)
    return (
      <ChartPlaceholder loading={loading} height={320}>
        No data.
      </ChartPlaceholder>
    );
  const tooltip = {
    formatter: (v: unknown) => [fmtValue(indicator, Number(v)), indicator.name],
    contentStyle: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 },
  };
  // Percent: whole-percent axis around zero (Recharts' own steps come out as 1.1, 2.2 …).
  const values = points.map((p) => p.value);
  // A round step giving at most ~8 ticks: 1 % for a few percent, 100 % for the hyperinflation of 1989–90 (ALL).
  const span = Math.max(0, Math.max(...values)) - Math.min(0, Math.min(...values));
  const step = [1, 2, 5, 10, 20, 50, 100, 200].find((s) => span / s <= 8) ?? 500;
  const pctDomain = indicator.unit === "%" ? [Math.min(0, Math.floor(Math.min(...values) / step) * step), Math.max(0, Math.ceil(Math.max(...values) / step) * step)] : undefined;
  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
      <YAxis
        {...(narrow ? narrowYAxis : { width: 56, tick: { fontSize: 11 } })}
        stroke="var(--muted)"
        domain={pctDomain ?? ["auto", "auto"]}
        ticks={pctDomain && Array.from({ length: (pctDomain[1]! - pctDomain[0]!) / step + 1 }, (_, k) => pctDomain[0]! + k * step)}
        tickFormatter={(v: number) => fmtNum(v, indicator.unit === "PLN" ? 2 : 0)}
      />
    </>
  );
  return (
    <div className="chart-frame" data-testid="indicator-chart" data-points={points.length} style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        {indicator.unit === "%" ? (
          <BarChart data={points} margin={chartMargin(narrow)}>
            {axes}
            <ReferenceLine y={0} stroke="var(--muted)" />
            <Tooltip {...tooltip} cursor={{ fill: "var(--border)", opacity: 0.4 }} />
            <Bar dataKey="value" isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.date} fill={p.value >= 0 ? "var(--accent)" : "var(--muted)"} />
              ))}
            </Bar>
          </BarChart>
        ) : (
          <LineChart data={points} margin={chartMargin(narrow)}>
            {axes}
            <Tooltip {...tooltip} />
            <Line type="monotone" dataKey="value" stroke="var(--accent)" dot={false} isAnimationActive={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
      <ChartBusy busy={loading} />
    </div>
  );
}
