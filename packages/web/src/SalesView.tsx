import { Fragment, useMemo } from "react";
import type { PitYear, Sale } from "@portfolio/core";
import { FilterBar, FilterSelect, FilterText, matchesText, uniqueOptions } from "./Filters.tsx";
import { fmtInt, fmtNum, fmtPct, fmtPln, signClass } from "./format.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { useApi } from "./useApi.ts";
import { useNarrow } from "./useNarrow.ts";

export interface SalesResponse {
  sales: Sale[];
  years: PitYear[];
}

const KIND_LABELS: Record<Sale["type"], string> = { SELL: "sale", REDEMPTION: "redemption", WRITE_OFF: "write-off" };
const qty = (v: number) => fmtNum(v, Number.isInteger(v) ? 0 : 2);
const days = (d: number) => `${fmtInt(d)} ${d === 1 ? "day" : "days"}`;

/**
 * Sales (road map 9): every sale, redemption and write-off, newest first, each folding out into the buys FIFO matched
 * it against; on top, per year, the PIT-38 summary (sales and redemptions outside IKE/IKZE, PLN at NBP D-1).
 */
export function SalesView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const data = useApi<SalesResponse>("/sales");
  const d = data.data;
  const narrow = useNarrow();
  const year = params["year"] ?? "";
  const account = params["account"] ?? "";
  const text = params["q"] ?? "";
  const open = params["sale"] ?? null;
  const set = (p: Record<string, string | undefined>) => setParams({ ...params, ...p });

  const all = d?.sales ?? [];
  const shown = useMemo(() => all.filter((s) => (!year || s.date.startsWith(year)) && (!account || s.account === account) && matchesText(text, s)), [all, year, account, text]);
  const years = uniqueOptions(all, (s) => ({ value: s.date.slice(0, 4), label: s.date.slice(0, 4) })).reverse();
  const accounts = uniqueOptions(all, (s) => ({ value: s.account, label: s.account }));
  const toggle = (s: Sale) => set({ sale: open === s.id ? undefined : s.id });
  const sum = (k: "proceeds" | "cost" | "gain") => Math.round(shown.reduce((n, s) => n + s[k], 0) * 100) / 100;

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Sales</h2>
      </header>
      <p className="muted hs-intro">
        Every sale, redemption and write-off with what those units cost (FIFO, fees included); a row folds out into the buys it was matched against. In PLN, another currency
        at the NBP rate of the day before, as for tax.
      </p>
      {data.error && <p className="error">{data.error}</p>}

      <section className="panel pit" data-testid="pit">
        <h3>PIT-38</h3>
        {d && d.years.length === 0 && <p className="muted">No sales or redemptions to declare.</p>}
        {(!d || d.years.length > 0) && (
          <table className="static compact" data-testid="pit-table">
            <thead>
              <tr>
                <th className="left">Year</th>
                {!narrow && <th>Sales</th>}
                <th title="Przychód: what they brought in, net of fees">Proceeds</th>
                <th title="Koszty: what the units cost, fees included">Costs</th>
                <th title="Dochód (or strata): proceeds − costs">Profit</th>
              </tr>
            </thead>
            <tbody>
              {!d && data.loading && <SkeletonRows rows={2} cols={narrow ? 4 : 5} />}
              {d?.years.map((y) => (
                <tr key={y.year} className={`clickable${year === String(y.year) ? " selected" : ""}`} onClick={() => set({ year: year === String(y.year) ? undefined : String(y.year) })} data-testid="pit-row" data-year={y.year}>
                  <td className="left">
                    {y.year}
                    {narrow && <div className="sub muted">{y.count} {y.count === 1 ? "sale" : "sales"}</div>}
                  </td>
                  {!narrow && <td>{y.count}</td>}
                  <td>{fmtPln(y.proceeds)}</td>
                  <td>{fmtPln(y.cost)}</td>
                  <td className={signClass(y.gain)} data-testid="pit-gain">
                    {fmtPln(y.gain)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted pit-note">Sales and redemptions outside IKE/IKZE. Not in it: write-offs, and retail bonds (their interest is taxed when they're redeemed).</p>
      </section>

      <FilterBar
        active={!!(year || account || text)}
        onReset={() => setParams({})}
        summary={d ? `${shown.length} of ${all.length} sales${shown.length ? ` · gain ${fmtPln(sum("gain"))}` : ""}` : ""}
      >
        <FilterSelect label="Year" value={year} options={years} onChange={(v) => set({ year: v || undefined })} testId="filter-year" width="7rem" />
        <FilterSelect label="Account" value={account} options={accounts} onChange={(v) => set({ account: v || undefined })} testId="filter-account" />
        <FilterText label="Instrument" value={text} onChange={(v) => set({ q: v || undefined })} testId="filter-text" />
      </FilterBar>

      {narrow ? (
        <ul className="hs-list panel" data-testid="sales-table">
          {!d && data.loading && <li className="muted">Loading…</li>}
          {shown.map((s) => (
            <li key={s.id} className={open === s.id ? "selected" : ""} data-testid="sale-row" data-id={s.id}>
              <button type="button" className="hs-item" onClick={() => toggle(s)} aria-expanded={open === s.id}>
                <span className="hs-line">
                  <span className="hs-what">
                    <InstrumentLabel code={s.code} name={s.name} />
                  </span>
                  <span className={signClass(s.gain)} data-testid="sale-gain">
                    {fmtPln(s.gain)}
                  </span>
                </span>
                <span className="hs-line muted">
                  <span>
                    {s.date} · {s.account} · {KIND_LABELS[s.type]} of {qty(s.quantity)}
                  </span>
                  <span>{fmtPct(s.gainPct)}</span>
                </span>
                <span className="hs-line muted">
                  <span>
                    {fmtPln(s.proceeds)} for {fmtPln(s.cost)}
                  </span>
                  {!s.pit && <span className="flag">not in PIT: {s.notPit}</span>}
                </span>
              </button>
              {open === s.id && (
                <ul className="sale-pairs" data-testid="sale-pairs">
                  {s.pairs.map((p, i) => (
                    <li key={i} data-testid="sale-pair">
                      <span className="hs-line">
                        <span>
                          bought {p.buyDate} · {qty(p.quantity)}
                        </span>
                        <span className={signClass(p.gain)}>{fmtPln(p.gain)}</span>
                      </span>
                      <span className="hs-line muted">
                        <span>
                          {fmtPln(p.proceeds)} for {fmtPln(p.cost)}
                        </span>
                        <span>{days(p.days)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {d && shown.length === 0 && <li className="muted">{all.length ? "No sales match the filters." : "No sales yet."}</li>}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="static" data-testid="sales-table">
            <thead>
              <tr>
                <th className="left">Instrument</th>
                <th className="left">Date</th>
                <th>Quantity</th>
                <th title="Net of the fee">Proceeds</th>
                <th title="FIFO, the buys' fees included">Cost</th>
                <th>Gain</th>
                <th>%</th>
                <th className="left" title="Days from the buy to the sale (per buy)">Held</th>
              </tr>
            </thead>
            <tbody>
              {!d && data.loading && <SkeletonRows rows={6} cols={8} />}
              {shown.map((s) => {
                const isOpen = open === s.id;
                const single = s.pairs.length === 1 ? s.pairs[0]! : null;
                return (
                  <Fragment key={s.id}>
                    <tr className={`clickable${isOpen ? " selected" : ""}`} onClick={() => toggle(s)} aria-expanded={isOpen} data-testid="sale-row" data-id={s.id}>
                      <td className="left instrument">
                        <span className="caret" aria-hidden>
                          {isOpen ? "▾" : "▸"}
                        </span>{" "}
                        <InstrumentLabel code={s.code} name={s.name} />
                        <div className="sub muted">
                          {s.account}
                          {!s.pit && (
                            <span className="flag" title="Not in the PIT-38 summary" data-testid="sale-not-pit">
                              {s.notPit}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="left">
                        {s.date}
                        <div className="sub muted">{KIND_LABELS[s.type]}</div>
                      </td>
                      <td>{qty(s.quantity)}</td>
                      <td>{fmtPln(s.proceeds)}</td>
                      <td>{fmtPln(s.cost)}</td>
                      <td className={signClass(s.gain)} data-testid="sale-gain">
                        {fmtPln(s.gain)}
                      </td>
                      <td className={signClass(s.gain)}>{fmtPct(s.gainPct)}</td>
                      <td className="left muted">{single ? days(single.days) : `${s.pairs.length} buys`}</td>
                    </tr>
                    {isOpen &&
                      s.pairs.map((p, i) => (
                        <tr key={i} className="sale-pair" data-testid="sale-pair">
                          <td className="left">└ bought {p.buyDate}</td>
                          <td></td>
                          <td>{qty(p.quantity)}</td>
                          <td>{fmtPln(p.proceeds)}</td>
                          <td>{fmtPln(p.cost)}</td>
                          <td className={signClass(p.gain)}>{fmtPln(p.gain)}</td>
                          <td className={signClass(p.gain)}>{fmtPct(p.cost ? Math.round((p.gain / p.cost) * 10000) / 100 : null)}</td>
                          <td className="left">{days(p.days)}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              {d && shown.length === 0 && (
                <tr>
                  <td className="left muted" colSpan={8}>
                    {all.length ? "No sales match the filters." : "No sales yet."}
                  </td>
                </tr>
              )}
              {shown.length > 1 && (
                <tr className="total" data-testid="sales-total">
                  <td className="left" colSpan={3}>
                    Total
                  </td>
                  <td>{fmtPln(sum("proceeds"))}</td>
                  <td>{fmtPln(sum("cost"))}</td>
                  <td className={signClass(sum("gain"))}>{fmtPln(sum("gain"))}</td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
