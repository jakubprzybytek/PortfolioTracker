import { Fragment } from "react";
import type { BuyMoreRow } from "@portfolio/core";
import { fmtNum, signClass } from "./format.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { useNarrow } from "./useNarrow.ts";

const fmtRate = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${fmtNum(r * 100, 2)} %`);
const fmtSpread = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${r >= 0 ? "+" : "−"}${fmtNum(Math.abs(r) * 100, 2)} pp`);
const rowKey = (r: Pick<BuyMoreRow, "account" | "isin">) => `buy#${r.account}#${r.isin}`;
const fmtPrice = (r: BuyMoreRow) => `${fmtNum(r.price.perBond, 2)} ${r.price.currency === "PLN" ? "zł" : r.price.currency}`;
/** A price older than a week: the yield may be off. */
const oldPrice = (r: BuyMoreRow, today: string) => !!r.price.date && (Date.parse(today) - Date.parse(r.price.date)) / 86_400_000 > 7;

/** What a row's figures rest on, and how to read them. */
function Notes({ r }: { r: BuyMoreRow }) {
  return (
    <div className="hs-breakdown" data-testid="bm-notes">
      <ul className="muted">
        {r.price.commission > 0 && (
          <li>
            one bond: {fmtPrice(r)} + {fmtNum(r.price.commission, 2)} commission
          </li>
        )}
        {r.alternative && (
          <li>
            alternative: {r.alternative.label}, {fmtRate(r.alternative.yield)} after tax
          </li>
        )}
        {r.duration !== null && <li>duration {fmtNum(r.duration, 2)}: if yields rise by 1 pp, the price falls by about {fmtNum(r.duration, 1)} % (matters only if sold before maturity)</li>}
        {r.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Buy more?" (Hold or sell's other half): for each bond held, one more bought today at its last price, held to
 * maturity: the yield before and after tax, after inflation, over the retail bond on offer for a similar term, the
 * duration and the instrument's share of the portfolio. Best after-tax yield first; a row opens what it rests on.
 */
export function BuyMoreTable({ rows, today, loading, open, toggle }: { rows?: BuyMoreRow[]; today: string; loading: boolean; open: string | null; toggle: (key: string) => void }) {
  const narrow = useNarrow();
  if (narrow)
    return (
      <ul className="hs-list panel" data-testid="bm-table">
        {!rows && loading && <li className="muted">Loading…</li>}
        {rows?.map((r) => (
          <li key={rowKey(r)} className={open === rowKey(r) ? "selected" : ""} data-testid="bm-row" data-code={r.code}>
            <button type="button" className="hs-item" onClick={() => toggle(rowKey(r))}>
              <span className="hs-line">
                <span className="hs-what">
                  <InstrumentLabel code={r.code} name={r.name} />
                </span>
                <strong data-testid="bm-net">{fmtRate(r.netYield)}</strong>
              </span>
              <span className="hs-line muted">
                {r.account} · {r.maturity} ({fmtNum(r.years, 1)} y) · {fmtPrice(r)}
              </span>
              <span className="hs-line">
                <span className="muted">real {fmtRate(r.realYield)}</span>
                <span className={signClass(r.spread)}>{r.spread === null ? "" : `${fmtSpread(r.spread)} vs ${r.alternative?.series ?? ""}`}</span>
              </span>
            </button>
            {open === rowKey(r) && <Notes r={r} />}
          </li>
        ))}
        {rows && rows.length === 0 && <li className="muted">No bonds held.</li>}
      </ul>
    );
  return (
    <div className="table-wrap">
      <table data-testid="bm-table" className="static">
        <thead>
          <tr>
            <th className="left">Bond</th>
            <th>Maturity</th>
            <th title="One more bond today: the last price + accrued interest (retail: 100 zł for the series on offer), before commission">Price</th>
            <th title="Yield to maturity before tax: what one bond bought at that price earns a year if held to maturity, coupons reinvested at the same yield">Yield</th>
            <th title="The same after tax (19 % on coupons less the accrued interest paid, and on the gain over the price paid; none in IKE/IKZE): the figure to compare">After tax</th>
            <th title="After tax and after inflation at the CPI assumed: (1 + after tax) / (1 + CPI) − 1. For inflation-linked bonds the steadier figure">Real</th>
            <th title="After tax, over the retail treasury bond on offer for the nearest term (also after tax): what the bond pays for its extra risk (the issuer, the price until maturity)">Over retail</th>
            <th title="Modified duration: if yields rise 1 pp, the price falls about this many %. Only for fixed-rate bonds; matters only if sold before maturity">Duration</th>
            <th title="This instrument's share of the portfolio (positions + cash), all accounts">Weight</th>
          </tr>
        </thead>
        <tbody>
          {!rows && loading && <SkeletonRows rows={5} cols={9} />}
          {rows?.map((r) => {
            const isOpen = open === rowKey(r);
            return (
              <Fragment key={rowKey(r)}>
                <tr className={`clickable${isOpen ? " selected" : ""}`} onClick={() => toggle(rowKey(r))} data-testid="bm-row" data-code={r.code}>
                  <td className="left instrument">
                    <InstrumentLabel code={r.code} name={r.name} />
                    <div className="sub muted">{r.account}</div>
                  </td>
                  <td>
                    {r.maturity}
                    <div className="sub muted">{fmtNum(r.years, 1)} y</div>
                  </td>
                  <td>
                    {fmtPrice(r)}
                    <div className={`sub ${oldPrice(r, today) ? "status-failed" : "muted"}`} title={oldPrice(r, today) ? "An old price: the yield may be off" : undefined}>
                      {r.offerSeries ? "on offer" : r.price.date}
                    </div>
                  </td>
                  <td>{fmtRate(r.grossYield)}</td>
                  <td data-testid="bm-net">
                    <strong>{fmtRate(r.netYield)}</strong>
                    {r.taxFree && <div className="sub muted">tax-free</div>}
                  </td>
                  <td className={signClass(r.realYield)}>{fmtRate(r.realYield)}</td>
                  <td className={signClass(r.spread)} data-testid="bm-spread">
                    {fmtSpread(r.spread)}
                    {r.alternative?.series && <div className="sub muted">{r.alternative.series}</div>}
                  </td>
                  <td>{r.duration === null ? "–" : fmtNum(r.duration, 1)}</td>
                  <td>{fmtRate(r.weight)}</td>
                </tr>
                {isOpen && (
                  <tr className="hs-detail">
                    <td colSpan={9}>
                      <Notes r={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {rows && rows.length === 0 && (
            <tr>
              <td className="left muted" colSpan={9}>
                No bonds held.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
