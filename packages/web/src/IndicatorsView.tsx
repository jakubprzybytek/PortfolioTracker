import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum } from "./format.ts";
import type { Indicator } from "./types.ts";
import { useApi } from "./useApi.ts";

type IndicatorPoint = Indicator["points"][number];

/** Monthly data: ranges in years. */
const RANGES = [
  { key: "1Y", months: 12 },
  { key: "5Y", months: 60 },
  { key: "10Y", months: 120 },
  { key: "ALL", months: null },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

const fmtValue = (i: Indicator, v: number | undefined) => (v === undefined ? "–" : i.unit === "%" ? `${fmtNum(v, 1)} %` : fmtNum(v, 2));

/** The same month a year before the latest point. */
const yearBefore = (points: IndicatorPoint[]): IndicatorPoint | undefined => {
  const last = points.at(-1);
  if (!last) return undefined;
  const target = `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4)}`;
  return points.find((p) => p.date === target);
};

/** Economic indicators from the stored data: latest value, its month, a year earlier. Clicking a row shows its chart. */
export function IndicatorsView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const rows = useApi<Indicator[]>("/indicators");
  const selected = params["chart"] ?? null;
  const range: RangeKey = RANGES.some((r) => r.key === params["range"]) ? (params["range"] as RangeKey) : "5Y";
  const sel = rows.data?.find((i) => i.id === selected);
  const months = RANGES.find((r) => r.key === range)!.months;
  const points = sel ? (months === null ? sel.points : sel.points.slice(-months)) : [];

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
              <th>Month</th>
              <th>A year earlier</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((i) => {
              const last = i.points.at(-1);
              const before = yearBefore(i.points);
              return (
                <tr
                  key={i.id}
                  className={i.id === selected ? "selected" : ""}
                  onClick={() => setParams({ ...params, chart: i.id === selected ? undefined : i.id })}
                  style={{ cursor: "pointer" }}
                  data-testid={`indicator-${i.id}`}
                  title={i.note}
                >
                  <td className="left instrument">
                    <strong>{i.name}</strong>
                  </td>
                  <td>{fmtValue(i, last?.value)}</td>
                  <td>{last?.date ?? "no data"}</td>
                  <td className="muted" title={before ? before.date : ""}>
                    {fmtValue(i, before?.value)}
                  </td>
                </tr>
              );
            })}
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
          <div className="range" data-testid="indicator-range">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                className={r.key === range ? "active" : ""}
                aria-pressed={r.key === range}
                onClick={() => setParams({ ...params, range: r.key === "5Y" ? undefined : r.key })}
              >
                {r.key}
              </button>
            ))}
          </div>
          <IndicatorChart indicator={sel} points={points} />
        </>
      )}
    </>
  );
}

/** Percent changes as bars around zero (rises in the accent colour, falls grey); an index as a line. */
function IndicatorChart({ indicator, points }: { indicator: Indicator; points: IndicatorPoint[] }) {
  if (points.length === 0) return <p className="muted">No data.</p>;
  const tooltip = {
    formatter: (v: unknown) => [fmtValue(indicator, Number(v)), indicator.name],
    contentStyle: { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 },
  };
  // Percent: whole-percent axis around zero (Recharts' own steps come out as 1.1, 2.2 …).
  const values = points.map((p) => p.value);
  const pctDomain = indicator.unit === "%" ? [Math.min(0, Math.floor(Math.min(...values))), Math.max(0, Math.ceil(Math.max(...values)))] : undefined;
  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" vertical={false} />
      <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={40} stroke="var(--muted)" />
      <YAxis tick={{ fontSize: 11 }} width={56} stroke="var(--muted)" domain={pctDomain ?? ["auto", "auto"]} ticks={pctDomain && Array.from({ length: pctDomain[1]! - pctDomain[0]! + 1 }, (_, k) => pctDomain[0]! + k)} tickFormatter={(v: number) => fmtNum(v, indicator.unit === "%" ? 1 : 0)} />
    </>
  );
  return (
    <div data-testid="indicator-chart" data-points={points.length} style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        {indicator.unit === "%" ? (
          <BarChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
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
          <LineChart data={points} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            {axes}
            <Tooltip {...tooltip} />
            <Line type="monotone" dataKey="value" stroke="var(--accent)" dot={false} isAnimationActive={false} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
