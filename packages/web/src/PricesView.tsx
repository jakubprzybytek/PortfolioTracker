import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartPanel } from "./ChartPanel.tsx";
import { FilterBar, FilterSelect, FilterText, FilterToggle, matchesText, uniqueOptions } from "./Filters.tsx";
import { addDays, fmtNum, fmtPct, fmtTime, priceAgeTitle, rangeBefore, rangeFrom, signClass, today, typeLabel, type RangeKey } from "./format.ts";
import { InstrumentLabel } from "./InstrumentLabel.tsx";
import { ManualValues } from "./ManualValues.tsx";
import { CouponPeriods, CouponPeriodsButton } from "./CouponPeriods.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { PriceChart } from "./PriceChart.tsx";
import { RangePicker } from "./RangePicker.tsx";
import type { Price, PriceRow, Transaction } from "./types.ts";
import { useApi } from "./useApi.ts";
import { RefreshPrices } from "./RefreshPrices.tsx";
import { useShowClosed } from "./showClosed.ts";

/** Bonds are priced in % of nominal; other instruments in their currency; retail bonds show their interest rate. */
const fmtPrice = (r: PriceRow) =>
  r.rate ? `${fmtNum(r.rate.current * 100)} % p.a.` : r.price === null ? "–" : r.type.startsWith("BOND") ? `${fmtNum(r.price)} %` : `${fmtNum(r.price)} ${r.currency}`;

/**
 * Held instruments: latest price, its date, change over a year. Filter by asset type and free text (name or code). Clicking a row shows its price
 * chart in a resizable panel docked to the bottom (as in Holdings); the open chart and the filter are in the URL.
 * "Show closed" (shared with Holdings while the app is open) adds the instruments traded but held no more, greyed, after the others: their last price
 * and the year up to it; their chart ranges count back from a month after the last transaction (ALL: from a month before the first).
 */
export function PricesView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const [showClosed, setShowClosed] = useShowClosed();
  const rows = useApi<PriceRow[]>("/prices", { closed: showClosed ? "1" : undefined });
  const type = params["type"] ?? "";
  const text = params["q"] ?? "";
  const selected = params["chart"] ?? null;
  const [range, setRange] = useState<RangeKey>("1Y");
  const [panelHeight, setPanelHeight] = useState(0);
  /** The bond whose coupon periods replace its chart in the panel. */
  const [couponsFor, setCouponsFor] = useState<string | null>(null);
  const all = rows.data ?? [];
  const sel = all.find((r) => r.isin === selected);
  // An instrument held no more: the range counts back from a month after its last transaction (ALL: from a month before its first).
  const span = sel?.closed;
  const spanEnd = span ? addDays(span.lastDate, 31) : undefined;
  const prices = useApi<Price[]>(selected ? `/instruments/${selected}/prices` : null, span && spanEnd ? { from: rangeBefore(range, spanEnd, addDays(span.firstDate, -31)), to: spanEnd } : { from: rangeFrom(range), to: today() });
  const txs = useApi<Transaction[]>(selected ? `/instruments/${selected}/transactions` : null);
  // Held ones by code, then the closed ones by code.
  const shown = all.filter((r) => (!type || r.type === type) && matchesText(text, r)).sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || a.code.localeCompare(b.code));
  const closedCount = shown.filter((r) => r.closed).length;
  const types = useMemo(() => uniqueOptions(all, (r) => ({ value: r.type, label: typeLabel(r.type) })), [all]);
  const newest = all.filter((r) => !r.closed).map((r) => r.priceDate).filter((d): d is string => !!d).sort().at(-1);
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
        <span className="view-meta">
          <span className="muted" data-testid="prices-date">
            {newest ? `as of ${newest}` : rows.loading ? "Loading…" : ""}
          </span>
          <RefreshPrices />
        </span>
      </header>
      {rows.error && <p className="error">{rows.error}</p>}

      <FilterBar
        active={!!(type || text)}
        onReset={() => setParams({ chart: selected ?? undefined })}
        summary={rows.loading ? "Loading…" : `${shown.length - closedCount} of ${all.filter((r) => !r.closed).length} instruments${showClosed ? ` + ${closedCount} closed` : ""}`}
      >
        <FilterSelect label="Asset type" value={type} options={types} onChange={(v) => setParams({ ...params, type: v || undefined })} testId="filter-type" />
        <FilterText label="Instrument" value={text} onChange={(v) => setParams({ ...params, q: v || undefined })} testId="filter-text" />
        <FilterToggle label="Show closed" checked={showClosed} onChange={setShowClosed} testId="show-closed" title="Also the instruments traded but held no more" />
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
            {!rows.data && rows.loading && <SkeletonRows rows={8} cols={5} />}
            {shown.map((r) => (
              <tr
                key={r.isin}
                className={`clickable${r.closed ? " closed" : ""}${r.isin === selected ? " selected" : ""}`}
                onClick={() => setParams({ ...params, chart: r.isin === selected ? undefined : r.isin })}
                title={r.closed ? `Held no more: traded ${r.closed.firstDate} – ${r.closed.lastDate}. Show its price then.` : "Show its price over time"}
                data-testid={`price-${r.code}`}
              >
                <td className="left instrument">
                  <InstrumentLabel code={r.code} name={r.name} />
                </td>
                <td className="left">{typeLabel(r.type)}</td>
                <td>{fmtPrice(r)}</td>
                {r.closed ? (
                  <>
                    <td title={`Last price; last transaction ${r.closed.lastDate}`}>
                      {r.priceDate ?? (r.type === "BOND_RETAIL" ? "calculated" : "no price")}
                      <span className="flag" data-testid="closed-flag">
                        closed {r.closed.lastDate}
                      </span>
                    </td>
                    <td className={signClass(r.change1y)} title={r.yearAgo ? `${fmtNum(r.yearAgo.price)} on ${r.yearAgo.date}, a year before the last price` : "no price a year before the last one"}>
                      {r.change1y === null ? "–" : fmtPct(r.change1y * 100)}
                    </td>
                  </>
                ) : r.type === "BOND_RETAIL" ? (
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
                    <td className={r.stale || (r.priceDate && newest && r.priceDate < newest) ? "muted" : ""} title={r.stale ? "Older than a week: no recent price" : priceAgeTitle(r.priceDate, r.priceTime)}>
                      {r.priceDate ?? "no price"}
                      {r.priceTime && (
                        <span className="price-time" data-testid="price-time">
                          {fmtTime(r.priceTime)}
                        </span>
                      )}
                      {r.stale && r.priceDate && <span className="flag">stale</span>}
                      {r.manual && (
                        <span className="flag" title="Valued by hand: open the chart for a new value">
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
                  {all.length === 0 ? "Nothing held yet." : "No instruments match the filters."}
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
                {sel?.type === "BOND_LISTED" || sel?.type === "BOND_CORPORATE"
                  ? " · clean price, % of nominal"
                  : sel?.type === "BOND_IBKR"
                    ? sel.calculated
                      ? ` · calculated (constant yield between your trades and redemption), % of nominal in ${sel.currency}`
                      : ` · clean price on Börse Stuttgart, % of nominal in ${sel.currency}`
                  : sel?.type === "BOND_RETAIL"
                    ? " · value per bond, PLN (calculated, nominal 100)"
                    : sel
                      ? ` · close, ${sel.currency}`
                      : ""}
                {prices.data?.some((p) => p.nominal != null) && " · dashed: indexed nominal per bond, PLN (right axis)"}
              </span>
            </span>
          }
        >
          <div className="chart-tools">
            {couponsFor === selected ? <span /> : <RangePicker value={range} onChange={setRange} busy={prices.loading} testId="price-range" />}
            {sel?.manual && <ManualValues key={sel.isin} isin={sel.isin} code={sel.code} currency={sel.currency} />}
            {sel?.type === "BOND_CORPORATE" && <CouponPeriodsButton open={couponsFor === selected} onToggle={() => setCouponsFor(couponsFor === selected ? null : selected)} />}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: couponsFor === selected ? "auto" : undefined }}>
            {sel?.type === "BOND_CORPORATE" && couponsFor === selected ? (
              <CouponPeriods key={selected} isin={selected} code={sel.code} />
            ) : prices.error ? (
              <p className="error">{prices.error}</p>
            ) : (
              <PriceChart
                prices={prices.data ?? []}
                transactions={txs.data ?? []}
                calculated={sel?.type === "BOND_RETAIL"}
                loading={prices.loading}
                unit={sel?.type === "BOND_LISTED" || sel?.type === "BOND_CORPORATE" || sel?.type === "BOND_IBKR" ? "%" : (sel?.currency ?? "")}
              />
            )}
          </div>
        </ChartPanel>
      )}
    </>
  );
}
