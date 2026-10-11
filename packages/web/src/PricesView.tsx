import { useState } from "react";
import { fmtNum, fmtPct, rangeFrom, signClass, today, typeLabel, type RangeKey } from "./format.ts";
import { PriceChart } from "./PriceChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { Price, PriceRow, Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Bonds are priced in % of nominal; other instruments in their currency; retail bonds show their interest rate. */
const fmtPrice = (r: PriceRow) =>
  r.rate ? `${fmtNum(r.rate.current * 100)} % p.a.` : r.price === null ? "–" : r.type.startsWith("BOND") ? `${fmtNum(r.price)} %` : `${fmtNum(r.price)} ${r.currency}`;

/** Held instruments: latest price, its date, change over a year. Clicking a row shows its price chart. */
export function PricesView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const rows = useApi<PriceRow[]>("/prices");
  const selected = params["chart"] ?? null;
  const [range, setRange] = useState<RangeKey>("1Y");
  const prices = useApi<Price[]>(selected ? `/instruments/${selected}/prices` : null, { from: rangeFrom(range), to: today() }, [selected, range]);
  const txs = useApi<Transaction[]>(selected ? `/instruments/${selected}/transactions` : null, {}, [selected]);
  const sel = rows.data?.find((r) => r.isin === selected);
  const newest = rows.data?.map((r) => r.priceDate).filter((d): d is string => !!d).sort().at(-1);

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Prices</h2>
        <span className="muted" data-testid="prices-date">
          {newest ? `as of ${newest}` : rows.loading ? "Loading…" : ""}
        </span>
      </header>
      {rows.error && <p className="error">{rows.error}</p>}

      <div className="table-wrap">
        <table data-testid="prices-table" className="static">
          <thead>
            <tr>
              <th className="left">Instrument</th>
              <th className="left">Type</th>
              <th>Price</th>
              <th>Price date</th>
              <th>1 year</th>
            </tr>
          </thead>
          <tbody>
            {(rows.data ?? []).map((r) => (
              <tr
                key={r.isin}
                className={r.isin === selected ? "selected" : ""}
                onClick={() => setParams({ chart: r.isin === selected ? undefined : r.isin })}
                style={{ cursor: "pointer" }}
                data-testid={`price-${r.code}`}
              >
                <td className="left instrument">
                  <strong>{r.code}</strong> <span className="muted">{r.name !== r.code ? r.name : ""}</span>
                </td>
                <td className="left">{typeLabel(r.type)}</td>
                <td>{fmtPrice(r)}</td>
                {r.type === "BOND_RETAIL" ? (
                  <>
                    <td className="muted" title="Not traded: value = nominal + interest at the published rate">
                      calculated
                    </td>
                    <td className="muted" title="Rate in the previous interest year">
                      {r.rate?.previous == null ? "–" : `${fmtNum(r.rate.previous * 100)} % before`}
                    </td>
                  </>
                ) : (
                  <>
                    <td className={r.stale ? "muted" : ""} title={r.stale ? "Older than a week: no recent price" : ""}>
                      {r.priceDate ?? "no price"}
                      {r.stale && r.priceDate && <span className="flag">stale</span>}
                      {r.manual && (
                        <span className="flag" title="Entered by hand (imports/prices/)">
                          manual
                        </span>
                      )}
                    </td>
                    <td className={signClass(r.change1y)} title={r.yearAgo ? `${fmtNum(r.yearAgo.price)} on ${r.yearAgo.date}` : "no price a year ago"}>
                      {r.change1y === null ? "–" : fmtPct(r.change1y * 100)}
                    </td>
                  </>
                )}
              </tr>
            ))}
            {!rows.loading && (rows.data ?? []).length === 0 && (
              <tr>
                <td className="left muted" colSpan={5}>
                  Nothing held yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <>
          <h2 data-testid="price-title">
            {sel?.code ?? selected}{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              {sel?.name}
              {sel?.type === "BOND_LISTED" ? " · clean price, % of nominal" : sel?.type === "BOND_RETAIL" ? " · value per bond, PLN (calculated, nominal 100)" : ""}
            </span>
          </h2>
          <RangePicker value={range} onChange={setRange} testId="price-range" />
          {prices.error ? <p className="error">{prices.error}</p> : <PriceChart prices={prices.data ?? []} transactions={txs.data ?? []} calculated={sel?.type === "BOND_RETAIL"} />}
        </>
      )}
    </>
  );
}
