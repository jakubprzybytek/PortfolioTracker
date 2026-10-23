import type { BuyMoreRow } from "@portfolio/core";
import { fmtNum, signClass } from "./format.ts";

const fmtRate = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${fmtNum(r * 100, 2)} %`);
const fmtSpread = (r: number | null | undefined) => (r === null || r === undefined ? "–" : `${r >= 0 ? "+" : "−"}${fmtNum(Math.abs(r) * 100, 2)} pp`);

/**
 * The "bought today" half of a row's breakdown in Buy, hold or sell: one more bond at its last price (price, accrued
 * interest, commission, paid), what it yields a year to maturity before and after tax and after inflation, over the
 * alternative, its duration and the instrument's weight. Retail: the series on offer.
 */
export function BoughtToday({ b, spread }: { b: BuyMoreRow; spread: number | null }) {
  const cur = b.price.currency === "PLN" ? "zł" : b.price.currency;
  const money = (v: number) => `${fmtNum(v, 2)} ${cur}`;
  const received = b.flows.reduce((s, f) => s + f.amount - f.tax, 0);
  return (
    <div data-testid="bm-bought">
      <h4>{b.offerSeries ? `Bought today: ${b.offerSeries}, on offer` : "One more bought today"}</h4>
      <table className="static compact" data-testid="bm-cost">
        <tbody>
          {b.price.accrued > 0 ? (
            <>
              <tr>
                <td className="left">Price{b.price.date ? ` (${b.price.date})` : ""}</td>
                <td>{money(b.price.perBond - b.price.accrued)}</td>
              </tr>
              <tr>
                <td className="left">Accrued interest</td>
                <td>{money(b.price.accrued)}</td>
              </tr>
            </>
          ) : (
            <tr>
              <td className="left">{b.offerSeries ? "Nominal" : `Price${b.price.date ? ` (${b.price.date})` : ""}`}</td>
              <td>{money(b.price.perBond)}</td>
            </tr>
          )}
          {b.price.commission > 0 && (
            <tr>
              <td className="left">Commission</td>
              <td>{money(b.price.commission)}</td>
            </tr>
          )}
          <tr className="total">
            <td className="left">Paid for one bond</td>
            <td>{money(b.price.perBond + b.price.commission)}</td>
          </tr>
          <tr>
            <td className="left">Received to maturity, after tax</td>
            <td>{money(received)}</td>
          </tr>
          <tr>
            <td className="left">A year, after tax{b.grossYield !== null ? ` (before: ${fmtRate(b.grossYield)})` : ""}</td>
            <td>
              <strong>{fmtRate(b.netYield)}</strong>
            </td>
          </tr>
          <tr title="After tax and after inflation at the CPI assumed">
            <td className="left">Real</td>
            <td className={signClass(b.realYield)}>{fmtRate(b.realYield)}</td>
          </tr>
          {spread !== null && (
            <tr title="After tax, over the alternative: what the bond pays for its extra risk (the issuer, the price until maturity)">
              <td className="left">Over the alternative</td>
              <td className={signClass(spread)}>{fmtSpread(spread)}</td>
            </tr>
          )}
          {b.duration !== null && (
            <tr title="If yields rise by 1 pp, the price falls by about this many % (matters only if sold before maturity)">
              <td className="left">Duration</td>
              <td>{fmtNum(b.duration, 2)}</td>
            </tr>
          )}
          {b.weight !== null && (
            <tr title="This instrument's share of the portfolio (positions + cash), all accounts">
              <td className="left">Weight in the portfolio</td>
              <td>{fmtRate(b.weight)}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
