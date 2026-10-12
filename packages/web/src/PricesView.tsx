import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartPanel } from "./ChartPanel.tsx";
import { FilterBar, FilterSelect, uniqueOptions } from "./Filters.tsx";
import { fmtNum, fmtPct, rangeFrom, signClass, today, typeLabel, type RangeKey } from "./format.ts";
import { PriceChart } from "./PriceChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { Price, PriceRow, Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";

/** Bonds are priced in % of nominal; other instruments in their currency; retail bonds show their interest rate. */
const fmtPrice = (r: PriceRow) =>
  r.rate ? `${fmtNum(r.rate.current * 100)} % p.a.` : r.price === null ? "–" : r.type.startsWith("BOND") ? `${fmtNum(r.price)} %` : `${fmtNum(r.price)} ${r.currency}`;

/**
 * Held instruments: latest price, its date, change over a year. Filter by asset type. Clicking a row shows its price
 * chart in a resizable panel docked to the bottom (as in Holdings); the open chart and the filter are in the URL.
 */
export function PricesView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const rows = useApi<PriceRow[]>("/prices");
  const type = params["type"] ?? "";
  const selected = params["chart"] ?? null;
  const [range, setRange] = useState<RangeKey>("1Y");
  const [panelHeight, setPanelHeight] = useState(0);
  const prices = useApi<Price[]>(selected ? `/instruments/${selected}/prices` : null, { from: rangeFrom(range), to: today() }, [selected, range]);
  const txs = useApi<Transaction[]>(selected ? `/instruments/${selected}/transactions` : null, {}, [selected]);
  const all = rows.data ?? [];
  const shown = all.filter((r) => !type || r.type === type);
  const types = useMemo(() => uniqueOptions(all, (r) => ({ value: r.type, label: typeLabel(r.type) })), [all]);
  const sel = all.find((r) => r.isin === selected);
  const newest = all.map((r) => r.priceDate).filter((d): d is string => !!d).sort().at(-1);
  const closeChart = useCallback(() => setParams({ ...params, chart: undefined }), [params, setParams]);

  // Keep the clicked row visible above the panel.
  useEffect(() => {
    if (!selected || panelHeight === 0) return;
    const row = document.querySelector<HTMLElement>("tr.selected");
    if (!row) return;
    const bottom = row.getBoundingClientRect().bottom;
    if (bottom > window.innerHeight - panelHeight) window.scrollBy({ top: bottom - (window.innerHeight - panelHeight) + 16, behavior: "smooth" });
  }, [selected, panelHeight]);

  return (
    <>
      <header className="view-header">
        <h2 className="view-title">Prices</h2>
        <span className="muted" data-testid="prices-date">
          {newest ? `as of ${newest}` : rows.loading ? "Loading…" : ""}
        </span>
      </header>
      {rows.error && <p className="error">{rows.error}</p>}

      <FilterBar active={!!type} onReset={() => setParams({ chart: selected ?? undefined })} summary={rows.loading ? "Loading…" : `${shown.length} of ${all.length} instruments`}>
        <FilterSelect label="Asset type" value={type} options={types} onChange={(v) => setParams({ ...params, type: v || undefined })} testId="filter-type" />
      </FilterBar>

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
            {shown.map((r) => (
              <tr
                key={r.isin}
                className={`clickable${r.isin === selected ? " selected" : ""}`}
                onClick={() => setParams({ ...params, chart: r.isin === selected ? undefined : r.isin })}
                title="Show its price over time"
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
            {!rows.loading && shown.length === 0 && (
              <tr>
                <td className="left muted" colSpan={5}>
                  {all.length === 0 ? "Nothing held yet." : "No instruments of this type."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Room below the list so its last rows can scroll above the docked chart. */}
      {selected && <div style={{ height: panelHeight }} aria-hidden />}
      {selected && (
        <ChartPanel
          onClose={closeChart}
          onHeight={setPanelHeight}
          title={
            <span data-testid="price-title">
              {sel?.code ?? selected}{" "}
              <span className="muted" style={{ fontWeight: 400 }}>
                {sel && sel.name !== sel.code ? sel.name : ""}
                {sel?.type === "BOND_LISTED"
                  ? " · clean price, % of nominal"
                  : sel?.type === "BOND_RETAIL"
                    ? " · value per bond, PLN (calculated, nominal 100)"
                    : sel
                      ? ` · close, ${sel.currency}`
                      : ""}
              </span>
            </span>
          }
        >
          <RangePicker value={range} onChange={setRange} testId="price-range" />
          <div style={{ flex: 1, minHeight: 0 }}>
            {prices.error ? (
              <p className="error">{prices.error}</p>
            ) : (
              <PriceChart
                prices={prices.data ?? []}
                transactions={txs.data ?? []}
                calculated={sel?.type === "BOND_RETAIL"}
                unit={sel?.type === "BOND_LISTED" ? "%" : (sel?.currency ?? "")}
              />
            )}
          </div>
        </ChartPanel>
      )}
    </>
  );
}
