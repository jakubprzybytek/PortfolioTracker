import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  growthOf100,
  type CpiLevel,
  type PeriodReturn,
  type TotalReturn,
} from "@portfolio/core/valuation/returns";
import { fmtNum, fmtPct, fmtPln, signClass } from "./format.ts";
import { ChartBusy, ChartPlaceholder, SkeletonRows } from "./Placeholders.tsx";
import type { HistoryPoint } from "./types.ts";
import { chartMargin, narrowYAxis, useNarrow } from "./useNarrow.ts";

/** `GET /portfolio/years`. */
export interface YearsResponse {
  years: PeriodReturn[];
  total: TotalReturn | null;
  cpi: CpiLevel[];
}

/** Keeps "−2 %" on one line: recharts wraps axis labels at spaces. */
const NBSP = " ";
const tooltipStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
};
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "–" : fmtPct(v * 100);
const monthName = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const fmtMonth = (m: string) => monthName.format(new Date(`${m}-15T00:00:00Z`));

/** The year's label: "2026 so far", "2022 from 1 Mar". */
function yearLabel(y: PeriodReturn): { label: string; sub?: string } {
  if (!y.partial) return { label: String(y.year) };
  if (y.startValue === 0)
    return { label: String(y.year), sub: `from ${y.from}` };
  return { label: String(y.year), sub: `to ${y.to}` };
}

/** Inflation, marked "≈" when partly compounded from the monthly figures, with the last month of CPI when it ends early. */
function Inflation({ r }: { r: PeriodReturn }) {
  const early = r.cpiThrough && r.to.slice(0, 7) !== r.cpiThrough;
  return (
    <span
      title={`CPI ${r.from} → ${r.to}${early ? `, published to ${fmtMonth(r.cpiThrough!)}` : ""}${r.cpiExact ? " (GUS, December of the previous year = 100)" : " (partly compounded from the monthly figures: approximate)"}`}
    >
      {r.cpiExact || r.inflation === null ? "" : "≈ "}
      {pct(r.inflation)}
      {early && (
        <sup className="muted">
          {NBSP}to {r.cpiThrough!.slice(5)}
        </sup>
      )}
    </span>
  );
}

/**
 * Per calendar year: value at the start and the end, money put in, profit, the time-weighted return (deposits and
 * withdrawals don't count), inflation (CPI December on December), the real return and the money-weighted XIRR; the
 * last row the whole history, its rates a year.
 */
export function YearsTable({
  data,
  loading,
}: {
  data?: YearsResponse;
  loading: boolean;
}) {
  const narrow = useNarrow();
  const t = data?.total;
  const cols = narrow ? 3 : 9;
  return (
    <div className="table-wrap returns" data-testid="years">
      <table className="static" data-testid="years-table">
        <thead>
          <tr>
            <th className="left">Year</th>
            {!narrow && (
              <th title="Value (positions + cash) at the end of the year before">
                Start
              </th>
            )}
            {!narrow && (
              <th title="Money put in − taken out during the year">Put in</th>
            )}
            {!narrow && (
              <th title="Value (positions + cash) at the end of the year">
                End
              </th>
            )}
            {!narrow && <th title="End − start − money put in">Profit</th>}
            <th title="Time-weighted return: each day's growth chained, so money put in or taken out doesn't count. Comparable with inflation and with funds">
              Return
            </th>
            {!narrow && (
              <th title="CPI over the same days (GUS; a whole year: December on December)">
                Inflation
              </th>
            )}
            <th title="(1 + return) / (1 + inflation) − 1: what the money gained in what it buys">
              Real
            </th>
            {!narrow && (
              <th title="Money-weighted return (XIRR) of the start value, the money put in and the end value: what your money earned, its timing included. A part of a year: over those days, not a year">
                XIRR
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {!data && loading && <SkeletonRows rows={4} cols={cols} />}
          {data && data.years.length === 0 && (
            <tr>
              <td className="left muted" colSpan={cols}>
                No valuation history yet.
              </td>
            </tr>
          )}
          {data?.years.map((y) => {
            const { label, sub } = yearLabel(y);
            return (
              <tr
                key={y.year}
                data-testid="years-row"
                data-year={y.year}
                className={y.partial ? "partial" : undefined}
              >
                <td className="left">
                  {label}
                  {sub && <div className="sub muted">{sub}</div>}
                </td>
                {!narrow && <td>{fmtPln(y.startValue)}</td>}
                {!narrow && <td>{fmtPln(y.netDeposits)}</td>}
                {!narrow && <td>{fmtPln(y.endValue)}</td>}
                {!narrow && (
                  <td className={signClass(y.profit)}>{fmtPln(y.profit)}</td>
                )}
                <td className={signClass(y.twr)} data-testid="years-twr">
                  {pct(y.twr)}
                  {narrow && (
                    <div className="sub muted">
                      inflation <Inflation r={y} />
                    </div>
                  )}
                </td>
                {!narrow && (
                  <td data-testid="years-inflation">
                    <Inflation r={y} />
                  </td>
                )}
                <td className={signClass(y.real)} data-testid="years-real">
                  {pct(y.real)}
                </td>
                {!narrow && (
                  <td className={signClass(y.xirr)} data-testid="years-xirr">
                    {pct(y.xirr)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        {t && data && data.years.length > 1 && (
          <tfoot>
            <tr
              data-testid="years-total"
              title={`Since ${t.from}, ${fmtNum(t.years, 1)} years. In all: return ${pct(t.twr)}, inflation ${pct(t.inflation)}, real ${pct(t.real)}`}
            >
              <td className="left">
                All
                <div className="sub muted">
                  a year, since {t.from.slice(0, 7)}
                </div>
              </td>
              {!narrow && <td>–</td>}
              {!narrow && <td>{fmtPln(t.netDeposits)}</td>}
              {!narrow && <td>{fmtPln(t.endValue)}</td>}
              {!narrow && (
                <td className={signClass(t.profit)}>{fmtPln(t.profit)}</td>
              )}
              <td className={signClass(t.twrPerYear)}>
                {pct(t.twrPerYear)}
                {narrow && (
                  <div className="sub muted">
                    inflation {pct(t.inflationPerYear)}
                  </div>
                )}
              </td>
              {!narrow && <td>{pct(t.inflationPerYear)}</td>}
              <td className={signClass(t.realPerYear)}>{pct(t.realPerYear)}</td>
              {!narrow && <td className={signClass(t.xirr)}>{pct(t.xirr)}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** A tick step in % giving 4–6 ticks over [min, max]. */
function pctTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const step =
    [1, 2, 2.5, 5, 10, 20, 25, 50].find((s) => (hi - lo) / s <= 6) ?? 100;
  const ticks: number[] = [];
  for (
    let v = Math.floor(lo / step) * step;
    v <= Math.ceil(hi / step) * step + 1e-9;
    v += step
  )
    ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** The bar chart's tooltip: the year (a part of one: its days) and its three figures, in a fixed order. */
function YearTip({ active, r }: { active?: boolean; r?: PeriodReturn }) {
  if (!active || !r) return null;
  return (
    <div className="chart-tip" style={tooltipStyle}>
      <div>{r.partial ? `${r.year}: ${r.from} → ${r.to}` : r.year}</div>
      <div style={{ color: "var(--accent)" }}>Return {pct(r.twr)}</div>
      <div style={{ color: "var(--cpi)" }}>
        Inflation {pct(r.inflation)}
        {r.cpiThrough && r.cpiThrough !== r.to.slice(0, 7)
          ? ` (to ${fmtMonth(r.cpiThrough)})`
          : ""}
      </div>
      <div className={signClass(r.real)}>Real {pct(r.real)}</div>
    </div>
  );
}

/** A series' key above a chart: a swatch (a line, dashed or not, or a dot) and its name. */
export function Key({
  items,
}: {
  items: {
    label: string;
    color: string;
    kind: "bar" | "line" | "dashed" | "dot";
  }[];
}) {
  return (
    <div className="chart-key">
      {items.map((i) => (
        <span key={i.label} className="chart-key-item">
          <i
            className={`chart-key-${i.kind}`}
            style={
              i.kind === "dashed"
                ? { borderColor: i.color }
                : { background: i.color }
            }
            aria-hidden
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Per year, oldest first: the return and inflation as a pair of bars, the real return as a dot (green above 0, red below). */
export function YearsChart({
  data,
  loading,
  height = 220,
}: {
  data?: YearsResponse;
  loading: boolean;
  height?: number;
}) {
  const narrow = useNarrow();
  const rows = [...(data?.years ?? [])]
    .reverse()
    .map((y) => ({
      year: y.partial ? `${y.year}*` : String(y.year),
      twr: y.twr === null ? null : y.twr * 100,
      inflation: y.inflation === null ? null : y.inflation * 100,
      real: y.real === null ? null : y.real * 100,
      r: y,
    }));
  if (rows.length === 0)
    return (
      <ChartPlaceholder loading={loading} height={height}>
        No valuation history yet.
      </ChartPlaceholder>
    );
  const values = rows
    .flatMap((r) => [r.twr, r.inflation, r.real])
    .filter((v): v is number => v !== null);
  const ticks = pctTicks(Math.min(...values), Math.max(...values));
  return (
    <>
      <Key
        items={[
          { label: "Return", color: "var(--accent)", kind: "bar" },
          { label: "Inflation", color: "var(--cpi)", kind: "bar" },
          { label: "Real return", color: "var(--pos)", kind: "dot" },
        ]}
      />
      <div
        className="chart-frame"
        data-testid="years-chart"
        style={{ width: "100%", height }}
      >
        <ResponsiveContainer>
          <ComposedChart
            data={rows}
            margin={chartMargin(narrow)}
            barGap={2}
            barCategoryGap="28%"
          >
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 11 }}
              stroke="var(--muted)"
            />
            <YAxis
              {...(narrow
                ? narrowYAxis
                : { width: 48, tick: { fontSize: 11 } })}
              stroke="var(--muted)"
              domain={[ticks[0]!, ticks.at(-1)!]}
              ticks={ticks}
              interval={0}
              tickFormatter={(v: number) => `${fmtNum(v, 0)}${NBSP}%`}
            />
            <Tooltip
              cursor={{ fill: "var(--band)" }}
              content={({ active, payload }) => (
                <YearTip
                  active={active}
                  r={
                    (payload?.[0]?.payload as { r?: PeriodReturn } | undefined)
                      ?.r
                  }
                />
              )}
            />
            <Bar
              dataKey="twr"
              fill="var(--accent)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="inflation"
              fill="var(--cpi)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Scatter
              dataKey="real"
              fill="var(--fg)"
              isAnimationActive={false}
              shape={(p: {
                cx?: number;
                cy?: number;
                payload?: { real: number | null };
              }) =>
                p.cx === undefined ||
                p.cy === undefined ||
                p.payload?.real == null ? (
                  <g />
                ) : (
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r={5}
                    fill={p.payload.real >= 0 ? "var(--pos)" : "var(--neg)"}
                    stroke="var(--panel)"
                    strokeWidth={2}
                  />
                )
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
        <ChartBusy busy={loading} />
      </div>
    </>
  );
}

/**
 * Growth of 100 zł from the start of the range: the portfolio's time-weighted return chained day by day, and what CPI
 * says 100 zł then needs to be to buy as much. Above the CPI line, the money buys more than it did.
 */
export function GrowthChart({
  history,
  cpi,
  loading,
  height = 220,
}: {
  history: HistoryPoint[];
  cpi?: CpiLevel[];
  loading: boolean;
  height?: number;
}) {
  const narrow = useNarrow();
  const points = history
    .filter(
      (h) =>
        h.total !== undefined && h.netDeposits !== undefined && h.total > 0,
    )
    .map((h) => ({
      date: h.date,
      total: h.total!,
      netDeposits: h.netDeposits!,
    }));
  if (points.length === 0)
    return (
      <ChartPlaceholder loading={loading} height={height}>
        No valuation history in this range.
      </ChartPlaceholder>
    );
  const data = growthOf100(points, cpi ?? []);
  const values = data
    .flatMap((d) => [d.portfolio, d.cpi])
    .filter((v): v is number => v !== null);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const step =
    [0.5, 1, 2, 5, 10, 20, 25, 50].find((s) => (hi - lo) / s <= 5) ?? 100;
  const ticks: number[] = [];
  for (
    let v = Math.floor(lo / step) * step;
    v <= Math.ceil(hi / step) * step + 1e-9;
    v += step
  )
    ticks.push(Math.round(v * 100) / 100);
  const end = data.at(-1)!;
  return (
    <>
      <Key
        items={[
          {
            label: `Portfolio ${fmtNum(end.portfolio, 2)} zł`,
            color: "var(--accent)",
            kind: "line",
          },
          {
            label: `Inflation (CPI) ${end.cpi === null ? "–" : `${fmtNum(end.cpi, 2)} zł`}`,
            color: "var(--cpi)",
            kind: "dashed",
          },
        ]}
      />
      <div
        className="chart-frame"
        data-testid="growth-chart"
        style={{ width: "100%", height }}
      >
        <ResponsiveContainer>
          <LineChart data={data} margin={chartMargin(narrow)}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              minTickGap={40}
              stroke="var(--muted)"
            />
            <YAxis
              {...(narrow
                ? narrowYAxis
                : { width: 48, tick: { fontSize: 11 } })}
              stroke="var(--muted)"
              domain={[ticks[0]!, ticks.at(-1)!]}
              ticks={ticks}
              interval={0}
              tickFormatter={(v: number) => fmtNum(v, step < 1 ? 1 : 0)}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [
                `${fmtNum(Number(v), 2)} zł`,
                name === "portfolio" ? "Portfolio" : "Inflation (CPI)",
              ]}
            />
            <Line
              type="monotone"
              dataKey="cpi"
              stroke="var(--cpi)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="portfolio"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        <ChartBusy busy={loading} />
      </div>
    </>
  );
}
