// A bond's panel in the Catalyst view: price and liquidity, the yield's make-up, the coupons, the issuer's track record.
import type { ReactNode } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtInt, fmtNum, today } from "../format.ts";
import { useApi } from "../useApi.ts";
import { chartMargin, useNarrow } from "../useNarrow.ts";
import type { BondDetail, BondOutcome, BondRow, ReportedEvent } from "./types.ts";
import { FLAG_TITLE, LEVEL_LABEL, couponLabel, pct, pp, webHref } from "./labels.ts";
import { LiquidityDots } from "./parts.tsx";
import { timeAxis } from "../timeAxis.ts";
import { timeAxisProps, yearLines } from "../TimeTick.tsx";

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
  // Months (or weeks, or years) on their first session, the year's start stronger.
  const axis = timeAxis(data.map((d) => d.date), narrow ? 6 : 12);
  const l = row.liquidity;
  // The latest quoted session: the ask is what a buyer pays, the bid what a seller gets.
  const last = [...detail.quotes].reverse().find((q) => q.bid || q.ask);
  const cur = row.currency === "PLN" ? "zł" : row.currency;
  // Each figure with its label, in the words a buyer or seller uses.
  const facts: [string, ReactNode, string?][] = [
    ["Liquidity", <span key="l" className="cat-liq-level"><LiquidityDots level={l.level} /> {cap(LEVEL_LABEL[l.level])}</span>],
    ["Traded", `${Math.round(l.traded30 * 30)} of the last 30 sessions`, `${Math.round(l.traded90 * 90)} of 90`],
    ...(l.medianTurnover30 !== null ? [["Typical turnover", `${fmtInt(Math.round(l.medianTurnover30))} ${cur}`, "a session (median of 30)"] as [string, ReactNode, string]] : []),
    ...(l.medianSpread30 !== null ? [["Bid–ask spread", `${fmtNum(l.medianSpread30)} pp`, "median of 30 sessions"] as [string, ReactNode, string]] : []),
    ...(l.daysToSell10k !== null ? [[`To trade 10 000 ${cur}`, `≈ ${l.daysToSell10k} session${l.daysToSell10k === 1 ? "" : "s"}`, "at a fifth of a session's turnover"] as [string, ReactNode, string]] : []),
    ...(last
      ? [
          ["Buy at (ask)", last.ask ? fmtNum(last.ask.price) : "–", last.ask ? `${fmtInt(last.ask.volume)} bonds offered` : "no offer"] as [string, ReactNode, string],
          ["Sell at (bid)", last.bid ? fmtNum(last.bid.price) : "–", last.bid ? `${fmtInt(last.bid.volume)} bonds wanted` : "no bid"] as [string, ReactNode, string],
        ]
      : []),
    ["Market", detail.market, last ? `quotes of ${last.date}` : undefined],
  ];
  return (
    <div className="cat-price">
      <dl className="cat-stats" data-testid="catalyst-liquidity">
        {facts.map(([label, value, note]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {value}
              {note && <span className="muted"> · {note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="cat-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={chartMargin(narrow)}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="date" {...timeAxisProps(axis)} />
          {/* Whole percents: "auto" picks fractional ticks (101.25) that don't fit the axis once prices pass 100. */}
          <YAxis yAxisId="p" domain={[(min: number) => Math.floor(min), (max: number) => Math.ceil(max)]} allowDecimals={false} tickFormatter={(v: number) => fmtInt(v)} width={narrow ? 36 : 44} />
          <YAxis yAxisId="t" orientation="right" hide />
          <Tooltip formatter={(v, name) => [name === "turnover" ? fmtInt(Math.round(Number(v))) : fmtNum(Number(v)), String(name)]} />
          {yearLines(axis, "p")}
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
      <table className="static cat-coupons" data-testid="catalyst-coupons">
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
  "not-paid": "not paid",
  "paid-late": "paid late",
  listed: "listed",
  unknown: "unknown",
};
/** The summary's figures, in the table's order of concern: how bonds ended, then those still trading. */
const STATS: [BondOutcome, string][] = [
  ["repaid", "Repaid"],
  ["early", "Redeemed early"],
  ["below-par", "Ended below par"],
  ["past-maturity", "Past maturity"],
  ["not-paid", "Not paid"],
  ["paid-late", "Paid late"],
  ["unknown", "Unknown"],
  ["listed", "Still listed"],
];
const REPORTED: Record<ReportedEvent["kind"], string> = {
  "missed-payment": "Payment missed",
  "late-payment": "Paid late",
  "terms-changed": "Terms changed",
  "bondholders-meeting": "Bondholders' meeting",
  "covenant-breach": "Covenant breached",
  waiver: "Waiver",
  insolvency: "Insolvency proceedings",
  "buyback-below-par": "Buy-back below par",
  paid: "Paid",
  reviewed: "Reports read",
};
const REPORTED_TONE: Record<ReportedEvent["kind"], string> = {
  "missed-payment": "out-not-paid",
  "late-payment": "out-paid-late",
  "terms-changed": "out-below-par",
  "covenant-breach": "out-below-par",
  insolvency: "out-not-paid",
  "buyback-below-par": "out-below-par",
  "bondholders-meeting": "out-unknown",
  waiver: "out-unknown",
  paid: "out-repaid",
  reviewed: "out-unknown",
};
const ACTION: Record<string, string> = { suspension: "suspended", lifting: "suspension lifted", exclusion: "excluded", other: "measure" };

/** How the issuer's past bonds ended (the daily-file archive and GPW's measures), and this bond's measures. */
export function TrackTab({ detail, loading }: { detail: Pick<BondDetail, "track" | "events"> | undefined; loading: boolean }) {
  if (!detail) return <p className="muted">{loading ? "Loading…" : ""}</p>;
  const t = detail.track;
  const c = t.counts;
  const ended = c.repaid + c.early + c["below-par"] + c.unknown + c["not-paid"] + c["paid-late"];
  const reported = t.reported ?? [];
  // Rare outcomes are shown only when there is one: the strip stays short for a clean issuer.
  const stats = STATS.filter(([k]) => (k !== "not-paid" && k !== "paid-late") || c[k] > 0);
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
      <dl className="cat-stats" data-testid="catalyst-track-summary">
        <div>
          <dt>{t.company ? `${t.company}'s bonds since` : t.prefix ? `Bonds coded ${t.prefix}… since` : "Bonds since"}</dt>
          <dd className="cat-stat-big">{t.since?.slice(0, 7) ?? "–"}</dd>
        </div>
        {stats.map(([k, label]) => (
          <div key={k} className={c[k] ? `out-${k}` : "out-zero"}>
            <dt>{label}</dt>
            <dd className="cat-stat-big">{c[k]}</dd>
          </div>
        ))}
        <div className={t.flags.length ? "out-flag" : "out-zero"}>
          <dt>Red flags</dt>
          <dd className="cat-stat-big">{t.flags.length}</dd>
        </div>
      </dl>
      {ended === 0 && <p className="muted cat-facts">None has ended yet: no record to judge by.</p>}
      {t.flags.length > 0 ? (
        <div className="cat-redflags" role="note" data-testid="catalyst-track-flags">
          <strong>Red flags</strong>
          <ul className="cat-flags">
            {t.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="cat-noflags">
          <span aria-hidden="true">✓</span> No red flags{" "}
          <span className="muted">
            (GPW markings, suspensions at the KNF's demand, bankruptcy, ends below par, bonds past maturity{t.reviewedTo ? `; the issuer's current reports, read to ${t.reviewedTo}` : ""})
          </span>
        </p>
      )}
      {reported.length > 0 && (
        <div className="cat-reported" data-testid="catalyst-track-reported">
          <strong>From the issuer's reports</strong>
          <ul>
            {reported.map((e) => (
              <li key={e.id}>
                <span className={`cat-outcome ${REPORTED_TONE[e.kind]}`}>{REPORTED[e.kind]}</span>{" "}
                <span className="num">{e.date}</span>
                {e.codes.length > 0 && <span className="muted"> · {e.codes.join(", ")}</span>}
                {e.resolvedOn && <span className="muted"> · paid {e.resolvedOn}</span>}
                <span> · {e.text}</span>{" "}
                <span className="muted">
                  (
                  {webHref(e.sourceUrl) ? (
                    <a href={webHref(e.sourceUrl)} target="_blank" rel="noopener noreferrer">
                      {e.source}
                    </a>
                  ) : (
                    e.source
                  )}
                  )
                </span>
                {e.quote && <blockquote className="cat-quote">{e.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {t.attention.length > 0 && (
        <details className="cat-facts" data-testid="catalyst-track-attention">
          <summary>
            Worth a look: {t.attention.length} (suspensions "in the participants' interest and safety", often short and technical; bondholders' meetings and waivers from the issuer's reports)
          </summary>
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
              <tr key={b.isin} className={b.flags.length ? "cat-flagged" : undefined}>
                <td className="left">{b.code}</td>
                <td className="left">{b.maturity ?? "–"}</td>
                <td className="left">
                  <span className={`cat-outcome out-${b.outcome}`}>{OUTCOME[b.outcome]}</span>
                </td>
                <td>{b.lastClose === null ? "–" : fmtNum(b.lastClose)}</td>
                <td className="left muted">
                  {b.confirmed ? "report: " : b.inferred ? "inferred: " : "GPW: "}
                  {b.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted cat-facts">
        {t.company ? "The company's bonds (linked through GLEIF and GPW). " : "Grouped by the code's prefix: the bond isn't linked to a company yet. "}"Inferred" is read from trading (when a bond left, its last price); only the issuer's reports confirm a payment
        {t.reviewedTo ? ` (read to ${t.reviewedTo})` : t.company ? " (not read yet for this company)" : ""}.
      </p>
    </div>
  );
}


const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
