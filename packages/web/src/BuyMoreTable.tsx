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

const KIND_LABELS: Record<BuyMoreRow["flows"][number]["kind"], string> = { coupon: "coupon", interest: "interest", redemption: "redemption" };

/** One row's numbers, as Hold or sell's breakdown: one bond bought today, what it pays to maturity, then what it rests on. */
function Notes({ r }: { r: BuyMoreRow }) {
  const cur = r.price.currency === "PLN" ? "zł" : r.price.currency;
  const money = (v: number) => `${fmtNum(v, 2)} ${cur}`;
  const cost = r.price.perBond + r.price.commission;
  const received = r.flows.reduce((s, f) => s + f.amount - f.tax, 0);
  return (
    <div className="hs-breakdown" data-testid="bm-notes">
      <div>
        <h4>{r.offerSeries ? `One ${r.offerSeries} today` : "One more bond today"}</h4>
        <table className="static compact" data-testid="bm-cost">
          <tbody>
            {r.price.accrued > 0 ? (
              <>
                <tr>
                  <td className="left">Price{r.price.date ? ` (${r.price.date})` : ""}</td>
                  <td>{money(r.price.perBond - r.price.accrued)}</td>
                </tr>
                <tr>
                  <td className="left">Accrued interest</td>
                  <td>{money(r.price.accrued)}</td>
                </tr>
              </>
            ) : (
              <tr>
                <td className="left">{r.offerSeries ? "Nominal" : `Price${r.price.date ? ` (${r.price.date})` : ""}`}</td>
                <td>{money(r.price.perBond)}</td>
              </tr>
            )}
            {r.price.commission > 0 && (
              <tr>
                <td className="left">Commission</td>
                <td>{money(r.price.commission)}</td>
              </tr>
            )}
            <tr className="total">
              <td className="left">Paid</td>
              <td>{money(cost)}</td>
            </tr>
            {r.alternative && (
              <tr>
                <td className="left">Alternative: {r.alternative.label}</td>
                <td>{fmtRate(r.alternative.yield)}</td>
              </tr>
            )}
            {r.duration !== null && (
              <tr title="If yields rise by 1 pp, the price falls by about this many % (matters only if sold before maturity)">
                <td className="left">Duration</td>
                <td>{fmtNum(r.duration, 2)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div>
        <h4>Held to maturity</h4>
        <table className="static compact" data-testid="bm-flows">
          <thead>
            <tr>
              <th className="left">Date</th>
              <th className="left">What</th>
              <th>Amount</th>
              <th>Tax</th>
            </tr>
          </thead>
          <tbody>
            {r.flows.map((f) => (
              <tr key={`${f.date}#${f.kind}`} title={f.projected ? "From the assumptions (a rate or an index not published yet)" : ""}>
                <td className="left">{f.date}</td>
                <td className="left">
                  {KIND_LABELS[f.kind]}
                  {f.projected && <span className="muted"> *</span>}
                </td>
                <td>{money(f.amount)}</td>
                <td>{f.tax ? `−${money(f.tax)}` : "–"}</td>
              </tr>
            ))}
            <tr className="total">
              <td className="left" colSpan={3}>
                Received after tax
              </td>
              <td>{money(received)}</td>
            </tr>
            <tr>
              <td className="left" colSpan={3}>
                A year, after tax{r.grossYield !== null ? ` (before: ${fmtRate(r.grossYield)})` : ""}
              </td>
              <td>
                <strong>{fmtRate(r.netYield)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="muted hs-notes">
        {r.flows.some((f) => f.projected) && <li>* from the assumptions</li>}
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
