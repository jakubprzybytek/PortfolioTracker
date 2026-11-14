// A bond's premium over the State through time, against its issuer's other bonds, its sector's and the market's
// (Docs/catalyst-premium-history-plan.md), and for a fixed coupon its yield over the State's: the bond panel's
// "Premium" and "Yield" views. Pointing at a day shows its figures in the header, as the price view.
import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtNum } from "../format.ts";
import { timeAxis } from "../timeAxis.ts";
import { timeAxisProps, yearLines } from "../TimeTick.tsx";
import { chartMargin, narrowYAxis, useNarrow } from "../useNarrow.ts";
import type { BondRow, PremiumView } from "./types.ts";

/** Percentage points from a fraction: "+3,45 pp". */
const pp = (x: number | null | undefined, sign = false) => (x === null || x === undefined ? "–" : `${sign && x > 0 ? "+" : x < 0 ? "−" : ""}${fmtNum(Math.abs(x * 100))} pp`);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${fmtNum(x * 100)}%`);

type Key = "bond" | "issuer" | "sector" | "market";

/** What moved the premium, in words. */
function verdictText(v: PremiumView, sector: string): string {
  switch (v.moves.verdict) {
    case "unchanged":
      return "about unchanged";
    case "sector":
      return `mostly its sector (${sector} moved with it)`;
    case "market":
      return "mostly the market (all bonds moved with it)";
    case "issuer":
      return v.issuerBonds > 0 ? "mostly the issuer (its other bonds moved too, the sector didn't)" : "mostly the issuer (the sector didn't move)";
    case "bond":
      return "mostly this bond (its issuer's other bonds moved less)";
    default:
      return "too few trades in the span to say";
  }
}

const indexOf = (state: { activeTooltipIndex?: number | string | null }) => (state.activeTooltipIndex == null ? null : Number(state.activeTooltipIndex));

export function PremiumChart({ row, view, since }: { row: BondRow; view: PremiumView; since: string | undefined }) {
  const narrow = useNarrow();
  const [active, setActive] = useState<number | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<Key>>(new Set());
  const sector = view.industry ?? "Sector";
  const data = view.series.map((p) => ({
    date: p.date,
    bond: p.bond === null ? null : p.bond * 100,
    issuer: p.issuer === undefined ? null : p.issuer * 100,
    sector: p.sector ? p.sector.median * 100 : null,
    band: p.sector ? [p.sector.q1 * 100, p.sector.q3 * 100] : null,
    market: p.market ? p.market.median * 100 : null,
  }));
  const axis = timeAxis(data.map((d) => d.date), narrow ? 6 : 12);
  const lastTraded = [...view.series].reverse().find((p) => p.bond !== null);
  const point = (active !== null ? view.series[active] : undefined) ?? view.series.at(-1);
  const shownBond = active !== null ? point?.bond : (lastTraded?.bond ?? null);
  const toggle = (k: Key) => setHidden((h) => (h.has(k) ? new Set([...h].filter((x) => x !== k)) : new Set([...h, k])));
  const series: { key: Key; label: string; color: string; style: "solid" | "dashed" | "dotted" | "band"; when: boolean }[] = [
    { key: "bond", label: row.code, color: "var(--accent)", style: "solid", when: view.basis !== null },
    { key: "issuer", label: "Issuer's other bonds", color: "var(--accent)", style: "dashed", when: view.issuerBonds > 0 },
    { key: "sector", label: `${sector} median`, color: "var(--muted)", style: "band", when: view.industry !== null },
    { key: "market", label: "Market median", color: "var(--fg)", style: "dotted", when: true },
  ];
  const years = row.years;
  return (
    <>
      <div className="cat-price-now" data-testid="catalyst-premium-now" aria-live="polite">
        <div>
          <span className="cat-price-big">{pp(shownBond)}</span>
          {view.moves.bond !== null && active === null && (
            <span className={`cat-price-change ${view.moves.bond > 0 ? "neg" : view.moves.bond < 0 ? "pos" : "muted"}`}>
              {pp(view.moves.bond, true)} <span className="muted">since {view.moves.from ?? since}</span>
            </span>
          )}
        </div>
        <div className="muted cat-price-sub">
          {point ? (active !== null ? point.date : `last trade ${lastTraded?.date ?? "–"}`) : ""}
          {point?.issuer !== undefined && ` · issuer ${pp(point.issuer)}`}
          {point?.sector && ` · ${sector} ${pp(point.sector.median)}`}
          {point?.market && ` · market ${pp(point.market.median)}`}
        </div>
      </div>
      <p className="cat-premium-verdict" data-testid="catalyst-premium-verdict">
        {view.basis === null ? (
          <span className="muted">No premium for this bond (no terms, another currency, or no trade in the span): its sector and the market only.</span>
        ) : (
          <>
            <strong>{cap(verdictText(view, sector))}.</strong>{" "}
            <span className="muted">
              This bond {pp(view.moves.bond, true)}
              {view.moves.issuer !== null && ` · issuer ${pp(view.moves.issuer, true)}`}
              {view.moves.sector !== null && ` · ${sector} ${pp(view.moves.sector, true)}`}
              {view.moves.market !== null && ` · market ${pp(view.moves.market, true)}`}
            </span>
          </>
        )}
      </p>
      <div className="cat-chart" data-testid="catalyst-premium-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={chartMargin(narrow)} onMouseMove={(st) => setActive(indexOf(st))} onTouchMove={(st) => setActive(indexOf(st))} onMouseLeave={() => setActive(null)}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" stroke="var(--muted)" {...timeAxisProps(axis)} />
            <YAxis domain={[(min: number) => Math.floor(Math.min(0, min)), (max: number) => Math.ceil(max)]} allowDecimals={false} tickFormatter={(v: number) => `${fmtNum(v, 0)}`} stroke="var(--muted)" {...(narrow ? narrowYAxis : { width: 36, tick: { fontSize: 12 } })} />
            <Tooltip content={() => null} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} isAnimationActive={false} />
            {yearLines(axis)}
            <Area dataKey="band" name="sector band" stroke="none" fill="var(--muted)" fillOpacity={0.12} hide={hidden.has("sector")} connectNulls isAnimationActive={false} />
            <Line dataKey="sector" name="sector" stroke="var(--muted)" strokeWidth={1.5} dot={false} hide={hidden.has("sector")} connectNulls isAnimationActive={false} />
            <Line dataKey="market" name="market" stroke="var(--fg)" strokeOpacity={0.55} strokeDasharray="1 3" strokeWidth={1.5} dot={false} hide={hidden.has("market")} connectNulls isAnimationActive={false} />
            <Line dataKey="issuer" name="issuer" stroke="var(--accent)" strokeOpacity={0.6} strokeDasharray="5 3" strokeWidth={1.5} dot={false} hide={hidden.has("issuer")} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="bond" name="bond" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2, fill: "var(--accent)", stroke: "none" }} activeDot={false} hide={hidden.has("bond")} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-chips" data-testid="catalyst-premium-series">
        {series
          .filter((x) => x.when)
          .map((x) => (
            <button key={x.key} type="button" className={`chart-chip${hidden.has(x.key) ? " off" : ""}`} aria-pressed={!hidden.has(x.key)} onClick={() => toggle(x.key)}>
              <span className={`chart-swatch ${x.style}`} style={{ color: x.color }} aria-hidden />
              {x.label}
            </button>
          ))}
      </div>
      <p className="muted cat-premium-note">
        {view.basis === "wz" ? "Premium: the margin adjusted for the price, over the State's floating bonds (WZ)." : view.basis === "fixed-curve" ? "Premium: the yield before tax over the State's fixed-rate bonds at the same maturity." : ""} Medians of the corporate bonds traded in the last 10 sessions; the band holds the middle half of {sector}.
        {years !== null && years < 1 && " Under a year to maturity: a small price move is a large premium move."}
      </p>
    </>
  );
}

/** A fixed coupon's yield over the State's at the same years, the gap shaded (the premium). */
export function YieldChart({ view }: { view: PremiumView }) {
  const narrow = useNarrow();
  const [active, setActive] = useState<number | null>(null);
  const yields = view.yields ?? [];
  const data = yields.map((y) => ({ date: y.date, yield: y.yield * 100, gov: y.gov * 100, gap: [y.gov * 100, y.yield * 100] }));
  const axis = timeAxis(data.map((d) => d.date), narrow ? 6 : 12);
  const point = (active !== null ? yields[active] : undefined) ?? yields.at(-1);
  return (
    <>
      <div className="cat-price-now" data-testid="catalyst-yield-now" aria-live="polite">
        <div>
          <span className="cat-price-big">{pct(point?.yield)}</span>
          <span className="cat-price-change muted">State {pct(point?.gov)} · premium {point ? pp(point.yield - point.gov) : "–"}</span>
        </div>
        <div className="muted cat-price-sub">{point ? (active !== null ? point.date : `last trade ${point.date}`) : "No trades in the span."} · before tax, at the session's price</div>
      </div>
      <div className="cat-chart" data-testid="catalyst-yield-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={chartMargin(narrow)} onMouseMove={(st) => setActive(indexOf(st))} onTouchMove={(st) => setActive(indexOf(st))} onMouseLeave={() => setActive(null)}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" stroke="var(--muted)" {...timeAxisProps(axis)} />
            <YAxis domain={[(min: number) => Math.floor(min), (max: number) => Math.ceil(max)]} allowDecimals={false} tickFormatter={(v: number) => `${fmtNum(v, 0)}%`} stroke="var(--muted)" {...(narrow ? narrowYAxis : { width: 40, tick: { fontSize: 12 } })} />
            <Tooltip content={() => null} cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }} isAnimationActive={false} />
            {yearLines(axis)}
            <Area dataKey="gap" name="premium" stroke="none" fill="var(--accent)" fillOpacity={0.14} isAnimationActive={false} />
            <Line dataKey="gov" name="State" stroke="var(--muted)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="yield" name="yield" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2, fill: "var(--accent)", stroke: "none" }} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-chips">
        <span className="chart-chip static"><span className="chart-swatch solid" style={{ color: "var(--accent)" }} aria-hidden />This bond's yield</span>
        <span className="chart-chip static"><span className="chart-swatch solid" style={{ color: "var(--muted)" }} aria-hidden />The State's, same maturity</span>
        <span className="muted chart-chips-note">shaded: the premium</span>
      </div>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
