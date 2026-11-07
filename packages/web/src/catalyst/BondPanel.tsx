// A bond's panel in the Catalyst view: price and liquidity, the yield's make-up, the coupons, the issuer's track record.
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtInt, fmtNum, today } from "../format.ts";
import { useApi } from "../useApi.ts";
import { chartMargin, useNarrow } from "../useNarrow.ts";
import type { BondDetail, BondOutcome, BondRow } from "./types.ts";
import { FLAG_TITLE, couponLabel, liquidityTitle, pct, pp } from "./labels.ts";

export function BondPanel({ row, tab, setTab }: { row: BondRow; tab: string; setTab: (t: string) => void }) {
  const detail = useApi<BondDetail>(`/catalyst/bonds/${row.isin}`);
  const d = detail.data;
  return (
    <div className="catalyst-panel">
      <div className="segmented cat-tabs" role="tablist">
        {[
          ["price", "Price & liquidity"],
          ["yield", "Yield"],
          ["coupons", "Coupons"],
          ["track", "Track record"],
        ].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k!)} data-testid={`catalyst-tab-${k}`}>
            {label}
          </button>
        ))}
      </div>
      {detail.error && <p className="error">{detail.error}</p>}
      {tab === "price" && <PriceTab row={row} detail={d} loading={detail.loading} />}
      {tab === "yield" && <YieldTab row={row} detail={d} />}
      {tab === "coupons" && <CouponsTab detail={d} loading={detail.loading} />}
      {tab === "track" && <TrackTab detail={d} loading={detail.loading} />}
    </div>
  );
}

export function PriceTab({ row, detail, loading }: { row: BondRow; detail: BondDetail | undefined; loading: boolean }) {
  const narrow = useNarrow();
  if (!detail) return <p className="muted">{loading ? "Loading…" : ""}</p>;
  const quotes = new Map(detail.quotes.map((q) => [q.date, q]));
  const data = detail.sessions.map((s) => ({ date: s.date, close: s.trades > 0 ? s.close : null, reference: s.close, turnover: s.turnover, bid: quotes.get(s.date)?.bid?.price ?? null, ask: quotes.get(s.date)?.ask?.price ?? null }));
  const l = row.liquidity;
  // The latest quoted session: the ask is what a buyer pays, the bid what a seller gets.
  const last = [...detail.quotes].reverse().find((q) => q.bid || q.ask);
  const side = (label: string, s: { price: number; volume: number } | undefined) => (s ? `${label} ${fmtNum(s.price)} for ${fmtInt(s.volume)} bonds` : `no ${label}`);
  return (
    <div className="cat-price">
      <p className="muted cat-facts" data-testid="catalyst-liquidity">
        {liquidityTitle(l, row.currency)}.{last ? ` Quotes on ${last.date}: ${side("ask", last.ask)} • ${side("bid", last.bid)}.` : ""} Market {detail.market}.
      </p>
      <div className="cat-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={chartMargin(narrow)}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} minTickGap={30} />
          {/* Whole percents: "auto" picks fractional ticks (101.25) that don't fit the axis once prices pass 100. */}
          <YAxis yAxisId="p" domain={[(min: number) => Math.floor(min), (max: number) => Math.ceil(max)]} allowDecimals={false} tickFormatter={(v: number) => fmtInt(v)} width={narrow ? 36 : 44} />
          <YAxis yAxisId="t" orientation="right" hide />
          <Tooltip formatter={(v, name) => [name === "turnover" ? fmtInt(Math.round(Number(v))) : fmtNum(Number(v)), String(name)]} />
          <Bar yAxisId="t" dataKey="turnover" fill="var(--line)" isAnimationActive={false} />
          <Line yAxisId="p" dataKey="reference" name="reference" stroke="var(--border)" dot={false} isAnimationActive={false} />
          <Line yAxisId="p" dataKey="close" name="close (traded)" stroke="var(--accent)" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="p" dataKey="bid" name="bid" stroke="var(--pos)" dot={false} strokeDasharray="4 3" connectNulls isAnimationActive={false} />
          <Line yAxisId="p" dataKey="ask" name="ask" stroke="var(--neg)" dot={false} strokeDasharray="4 3" connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

export function YieldTab({ row, detail }: { row: BondRow; detail: BondDetail | undefined }) {
  const t = detail?.terms;
  const items: [string, string][] = [
    ["Price", row.price === null ? "–" : `${fmtNum(row.price)}% of ${fmtInt(row.nominal ?? 0)} ${row.currency} (session ${row.date}${row.lastTraded && row.lastTraded !== row.date ? `; last trade ${row.lastTraded}` : ""})`],
    ["Accrued interest", row.accruedInterest === null ? "–" : `${fmtNum(row.accruedInterest)} ${row.currency} per bond`],
    ["Years to maturity", row.years === null ? "–" : `${fmtNum(row.years, 2)} (${row.maturity})`],
    ["Yield before tax", pct(row.yieldGross)],
    ["Yield after tax", `${pct(row.yieldNet)}${row.projected ? " (future coupons at the assumed base rate)" : ""}`],
    ["Alternative", row.alternative ? `${row.alternative.label}: ${pct(row.alternative.yieldNet)} after tax` : "–"],
    ["Vs alternative", pp(row.vsAlternative)],
    ["Premium over the State", `${pp(row.premium)}${row.premiumBasis === "wz" ? " (margin adjusted for price − WZ's)" : row.premiumBasis === "fixed-curve" ? " (yield − the fixed-rate curve)" : ""}`],
    ["Coupon", row.couponText ?? couponLabel(row)],
    ...(t?.issueValue ? ([["Issue in circulation", `${fmtInt(t.issueValue.amount)} ${t.issueValue.currency} (when read)`]] as [string, string][]) : []),
    ...(t?.secured !== undefined ? ([["Secured", t.secured ? "yes" : "no"]] as [string, string][]) : []),
    ...(row.flags.length ? ([["Notes", row.flags.map((f) => FLAG_TITLE[f] ?? f).join("; ")]] as [string, string][]) : []),
  ];
  return (
    <dl className="cat-facts-list" data-testid="catalyst-yield-facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
      <p className="muted">Bought at the session's price + accrued interest + commission, held to maturity, coupons reinvested at the same yield; tax 19% on coupons (less the accrued interest paid) and on the gain at maturity. A corporate bond's yield is what's promised; the premium is the pay for the issuer's risk.</p>
    </dl>
  );
}

export function CouponsTab({ detail, loading }: { detail: BondDetail | undefined; loading: boolean }) {
  if (!detail) return <p className="muted">{loading ? "Loading…" : ""}</p>;
  const now = today();
  if (detail.coupons.length === 0) return <p className="muted">{detail.terms?.periodsProblem ? `obligacje.pl's periods don't add up: ${detail.terms.periodsProblem}.` : "No interest periods (terms not read yet, or a treasury series: yearly coupons)."}</p>;
  return (
    <div className="table-wrap">
      <table className="static coupon-periods" data-testid="catalyst-coupons">
        <thead>
          <tr>
            <th className="left">From</th>
            <th className="left">To</th>
            <th className="left">Record day</th>
            <th className="left">Paid</th>
            <th>Rate</th>
          </tr>
        </thead>
        <tbody>
          {/* The latest period first. */}
          {[...detail.coupons].sort((a, b) => b.start.localeCompare(a.start)).map((c) => (
            <tr key={c.start} className={c.start <= now && now < c.end ? "current" : undefined} title={c.start <= now && now < c.end ? "The current period" : undefined}>
              <td className="left">{c.start}</td>
              <td className="left">{c.end}</td>
              <td className="left">{c.recordDate ?? "–"}</td>
              <td className="left">{c.paymentDate}</td>
              <td>{c.rate === undefined ? <span className="muted">–</span> : pct(c.rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OUTCOME: Record<BondOutcome, string> = {
  repaid: "repaid",
  early: "redeemed early",
  "below-par": "ended below par",
  "past-maturity": "past maturity",
  listed: "listed",
  unknown: "unknown",
};
const ACTION: Record<string, string> = { suspension: "suspended", lifting: "suspension lifted", exclusion: "excluded", other: "measure" };

/** How the issuer's past bonds ended (the daily-file archive and GPW's measures), and this bond's measures. */
export function TrackTab({ detail, loading }: { detail: BondDetail | undefined; loading: boolean }) {
  if (!detail) return <p className="muted">{loading ? "Loading…" : ""}</p>;
  const t = detail.track;
  const c = t.counts;
  const ended = c.repaid + c.early + c["below-par"] + c.unknown;
  return (
    <div className="cat-track" data-testid="catalyst-track">
      {detail.events.length > 0 && (
        <p className="cat-facts" data-testid="catalyst-events">
          This bond:{" "}
          {detail.events
            .map((e) => `${e.published.slice(0, 10)} ${ACTION[e.action] ?? e.action} (${e.reason})${e.inForce && e.action === "suspension" ? ", in force" : ""}`)
            .join(" • ")}
        </p>
      )}
      <p className="cat-facts" data-testid="catalyst-track-summary">
        Bonds coded {t.prefix}… since {t.since?.slice(0, 7) ?? "–"}: {c.repaid} repaid • {c.early} redeemed early • {c["below-par"]} ended below par • {c["past-maturity"]} past maturity • {c.unknown} unknown • {c.listed} listed
        {ended === 0 ? " (none ended yet: no record)" : ""}.
      </p>
      {t.flags.length > 0 ? (
        <ul className="cat-flags neg" data-testid="catalyst-track-flags">
          {t.flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : (
        <p className="muted cat-facts">No red flags (GPW markings, suspensions at the KNF's demand, bankruptcy, ends below par, bonds past maturity).</p>
      )}
      {t.attention.length > 0 && (
        <details className="cat-facts" data-testid="catalyst-track-attention">
          <summary>Worth a look: {t.attention.length} suspension{t.attention.length === 1 ? "" : "s"} "in the participants' interest and safety" (often short and technical)</summary>
          <ul className="cat-flags">
            {t.attention.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="table-wrap">
        <table className="static">
          <thead>
            <tr>
              <th className="left">Bond</th>
              <th className="left">Maturity</th>
              <th className="left">Outcome</th>
              <th>Last price</th>
              <th className="left">How we know</th>
            </tr>
          </thead>
          <tbody>
            {t.bonds.map((b) => (
              <tr key={b.isin} className={b.flags.length ? "neg" : undefined}>
                <td className="left">{b.code}</td>
                <td className="left">{b.maturity ?? "–"}</td>
                <td className="left">{OUTCOME[b.outcome]}</td>
                <td>{b.lastClose === null ? "–" : fmtNum(b.lastClose)}</td>
                <td className="left muted">
                  {b.inferred ? "inferred: " : "GPW: "}
                  {b.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted cat-facts">Grouped by the code's prefix until bonds are linked to companies. "Inferred" is read from trading (when a bond left, its last price); only the issuer's reports confirm a payment.</p>
    </div>
  );
}

