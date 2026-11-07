// The Catalyst view (Docs/ui.md, "Catalyst"): the bond table, its filters, the chart and the panel.
import { useCallback, useMemo, useState } from "react";
import { ChartPanel } from "../ChartPanel.tsx";
import { FilterBar, FilterSelect, FilterText, FilterToggle } from "../Filters.tsx";
import { fmtNum } from "../format.ts";
import { Icon } from "../Icons.tsx";
import { SkeletonRows } from "../Placeholders.tsx";
import { parseSort, sortParam, sortRows } from "../sort.ts";
import { SortTh } from "../SortTh.tsx";
import { StickyTable, useStickyToolbar } from "../sticky.tsx";
import { useApi } from "../useApi.ts";
import { useNarrow } from "../useNarrow.ts";
import type { BondRow, Screen } from "./types.ts";
import { FLAG_LABEL, FLAG_TITLE, SEGMENTS, SORT_KEYS, baseOf, couponLabel, liquidityTitle, pct, pp, sortValue } from "./labels.ts";
import { FILTER_KEYS, LIQUIDITY, MATURITIES, MIN_PREMIUM, MIN_YIELD, NOMINALS, matches, opt } from "./filters.ts";
import { BondTitle, LiquidityDots } from "./parts.tsx";
import { YieldChart } from "./YieldChart.tsx";
import { BondPanel } from "./BondPanel.tsx";
import { ViewsMenu } from "./ViewsMenu.tsx";
import { AssumptionsPanel, } from "./AssumptionsPanel.tsx";

/**
 * The Catalyst market (Docs/catalyst.md, "UI"): every listed bond with its yield against the safe alternative, its
 * premium over the State's curve and its liquidity; filters and the sort in the URL, saved views, a yield-against-
 * maturity chart, a row's panel (price and liquidity, the yield's make-up, coupons), the assumptions.
 */
export function CatalystView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const screen = useApi<Screen>("/catalyst/bonds");
  const narrow = useNarrow();
  const [toolbar, stickyStyle] = useStickyToolbar();
  const [panelHeight, setPanelHeight] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const all = screen.data?.rows ?? [];
  const sort = parseSort(params["sort"], SORT_KEYS);
  const set = (k: string, v: string | undefined) => setParams({ ...params, [k]: v || undefined });
  const shown = useMemo(() => {
    const filtered = all.filter((r) => matches(r, params));
    // The view's own order: the best net yield first, those without one after.
    const byYield = sortRows(filtered, { key: "yield", desc: true }, sortValue);
    return sortRows(byYield, sort, sortValue);
  }, [all, params, sort]);
  const selected = params["bond"] ? all.find((r) => r.isin === params["bond"]) : undefined;
  const closePanel = useCallback(() => setParams({ ...params, bond: undefined }), [params, setParams]);
  const types = useMemo(() => opt(all.map((r) => r.segment), (v) => SEGMENTS[v] ?? v), [all]);
  const currencies = useMemo(() => opt(all.map((r) => r.currency)), [all]);
  const bases = useMemo(() => opt(all.map(baseOf).filter(Boolean), (v) => (v === "fixed" ? "Fixed" : v === "zero" ? "Zero coupon" : v)), [all]);
  const activeFilters = FILTER_KEYS.filter((k) => k !== "sort" && k !== "stale" && params[k]).length;
  // Stale bonds the other filters would show (hidden unless "Show stale").
  const staleCount = useMemo(() => all.filter((r) => r.flags.includes("stale") && matches(r, { ...params, stale: "1" })).length, [all, params]);
  const toggleRow = (r: BondRow) => setParams({ ...params, bond: params["bond"] === r.isin ? undefined : r.isin });

  return (
    <div style={{ ...stickyStyle, paddingBottom: panelHeight }}>
      <header className="view-header">
        <h2 className="view-title">Catalyst</h2>
        <span className="view-meta">
          <span className="muted" data-testid="catalyst-date">
            {screen.data?.date ? <>as of <span className="nowrap">{screen.data.date}</span></> : screen.loading ? "Loading…" : ""}
          </span>
          <button type="button" className={`icon-button${settingsOpen ? " active" : ""}`} onClick={() => setSettingsOpen((o) => !o)} title="Assumptions: base rates, commission, the alternative" aria-expanded={settingsOpen} data-testid="catalyst-settings-toggle">
            <Icon name="instrument" size={18} />
          </button>
        </span>
      </header>
      {screen.error && <p className="error callout">{screen.error}</p>}
      {settingsOpen && <AssumptionsPanel onSaved={screen.reload} />}

      <div className="sticky-toolbar" ref={toolbar} data-testid="catalyst-toolbar">
        <FilterBar
          compact
          activeCount={activeFilters}
          search={<FilterText label="Bond" value={params["q"] ?? ""} onChange={(v) => set("q", v)} placeholder="Code or issuer" testId="catalyst-q" />}
          active={activeFilters > 0}
          onReset={() => setParams({ sort: params["sort"], bond: params["bond"], stale: params["stale"] })}
          summary={screen.loading && !screen.data ? "Loading…" : `${shown.length} of ${all.length} bonds${!params["stale"] && staleCount ? ` (+ ${staleCount} stale, hidden)` : ""}`}
          after={
            <>
              <FilterToggle label="Show stale" checked={!!params["stale"]} onChange={(on) => set("stale", on ? "1" : undefined)} testId="catalyst-stale" title="Also the bonds without a trade in the last 30 sessions" />
              <FilterToggle label="Chart" checked={!!params["chart"]} onChange={(on) => set("chart", on ? "1" : undefined)} testId="catalyst-chart-toggle" title="Yield against years to maturity, with the State's curve" />
              <ViewsMenu params={params} setParams={setParams} />
            </>
          }
        >
          <FilterSelect label="Type" value={params["type"] ?? ""} options={types} onChange={(v) => set("type", v)} testId="catalyst-type" width="10rem" />
          <FilterSelect label="Coupon" value={params["base"] ?? ""} options={bases} onChange={(v) => set("base", v)} testId="catalyst-base" width="9rem" />
          <FilterSelect label="Maturity" value={params["mat"] ?? ""} options={MATURITIES} onChange={(v) => set("mat", v)} testId="catalyst-mat" width="8rem" />
          <FilterSelect label="Nominal" value={params["nom"] ?? ""} options={NOMINALS} onChange={(v) => set("nom", v)} testId="catalyst-nom" width="7rem" />
          <FilterSelect label="Liquidity" value={params["liq"] ?? ""} options={LIQUIDITY} onChange={(v) => set("liq", v)} testId="catalyst-liq" width="10rem" />
          <FilterSelect label="Yield" value={params["yield"] ?? ""} options={MIN_YIELD} onChange={(v) => set("yield", v)} testId="catalyst-yield" width="8rem" />
          <FilterSelect label="Premium" value={params["prem"] ?? ""} options={MIN_PREMIUM} onChange={(v) => set("prem", v)} testId="catalyst-prem" width="7rem" />
          <FilterSelect label="Currency" value={params["cur"] ?? ""} options={currencies} onChange={(v) => set("cur", v)} testId="catalyst-cur" width="6rem" />
        </FilterBar>
      </div>

      {params["chart"] && screen.data && <YieldChart rows={shown} curve={screen.data.curve?.fixed ?? []} onPick={(isin) => setParams({ ...params, bond: isin })} />}

      {narrow ? (
        <ul className="hs-list panel catalyst-list" data-testid="catalyst-table">
          {!screen.data && screen.loading && <li className="muted">Loading…</li>}
          {shown.map((r) => (
            <li key={r.isin} className={r.isin === params["bond"] ? "selected" : ""} data-testid="catalyst-row" data-code={r.code}>
              <button type="button" className="cat-row" onClick={() => toggleRow(r)} aria-expanded={r.isin === params["bond"]}>
              <div className="cat-line">
                <strong>{r.code}</strong> <span className="muted">{r.issuer ?? ""}</span>
                <LiquidityDots level={r.liquidity.level} />
              </div>
              <div className="cat-line muted">
                {couponLabel(r)} · {r.years === null ? "–" : `${fmtNum(r.years, 1)} y`} · {r.price === null ? "–" : fmtNum(r.price)}
              </div>
              <div className="cat-line">
                {pct(r.yieldNet)} net <span className={r.vsAlternative !== null && r.vsAlternative < 0 ? "neg" : "pos"}>{pp(r.vsAlternative)}</span> · premium {pp(r.premium)}
              </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <StickyTable
          testId="catalyst-table"
          head={
            <tr>
              <SortTh label="Bond" sortKey="bond" sort={sort} onSort={(s) => set("sort", sortParam(s))} className="left" />
              <SortTh label="Issuer" sortKey="issuer" sort={sort} onSort={(s) => set("sort", sortParam(s))} className="left" />
              <SortTh label="Type" sortKey="type" sort={sort} onSort={(s) => set("sort", sortParam(s))} className="left" />
              <SortTh label="Coupon" sortKey="coupon" sort={sort} onSort={(s) => set("sort", sortParam(s))} className="left" firstDesc />
              <SortTh label="Maturity" sortKey="maturity" sort={sort} onSort={(s) => set("sort", sortParam(s))} />
              <SortTh label="Price" sortKey="price" sort={sort} onSort={(s) => set("sort", sortParam(s))} />
              <SortTh label="Yield net" sortKey="yield" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc title="Yield to maturity after 19% tax and the commission" />
              <SortTh label="Vs alt." sortKey="vsalt" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc title="Net yield − the alternative's net yield (percentage points)" />
              <SortTh label="Premium" sortKey="premium" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc title="Over the State: fixed coupons, yield − the curve at the same maturity; floating, margin adjusted for price − WZ's" />
              <SortTh label="Liquidity" sortKey="liquidity" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc />
            </tr>
          }
        >
          <tbody>
            {!screen.data && screen.loading && <SkeletonRows rows={12} cols={10} />}
            {shown.map((r) => (
              <tr key={r.isin} className={`clickable${r.isin === params["bond"] ? " selected" : ""}${r.flags.includes("stale") ? " closed" : ""}`} onClick={() => toggleRow(r)} data-testid="catalyst-row" data-code={r.code}>
                <td className="left" title={`${r.isin} · ${r.markets.join(", ")}`}>
                  <strong>{r.code}</strong>
                  {r.currency !== "PLN" && <span className="flag">{r.currency}</span>}
                  {r.flags
                    .filter((f) => FLAG_LABEL[f] && f !== "stale")
                    .map((f) => (
                      <span key={f} className="flag" title={FLAG_TITLE[f]}>
                        {FLAG_LABEL[f]}
                      </span>
                    ))}
                </td>
                <td className="left cat-issuer" title={r.issuer ?? ""}>
                  {r.issuer ?? <span className="muted">–</span>}
                </td>
                <td className="left">{SEGMENTS[r.segment] ?? r.segment}</td>
                <td className="left" title={r.couponText ?? ""}>
                  {couponLabel(r)}
                </td>
                <td title={r.maturity ?? ""}>{r.years === null ? "–" : `${fmtNum(r.years, 1)} y`}</td>
                <td title={r.lastTraded ? `Last trade ${r.lastTraded}; accrued interest ${fmtNum(r.accruedInterest)}` : "No trade in the last 90 sessions"}>{r.price === null ? "–" : fmtNum(r.price)}</td>
                <td title={r.yieldGross !== null ? `Before tax ${pct(r.yieldGross)}${r.projected ? "; future coupons at the assumed base rate" : ""}` : ""}>
                  {pct(r.yieldNet)}
                  {r.projected && r.yieldNet !== null && <span className="muted">*</span>}
                </td>
                <td className={r.vsAlternative === null ? "" : r.vsAlternative < 0 ? "neg" : "pos"} title={r.alternative ? `${r.alternative.label}: ${pct(r.alternative.yieldNet)} net` : ""}>
                  {pp(r.vsAlternative)}
                </td>
                <td title={r.premiumBasis === "wz" ? "Floating: margin adjusted for price − WZ's" : r.premiumBasis === "fixed-curve" ? "Fixed: yield before tax − the State's curve" : ""}>{pp(r.premium)}</td>
                <td title={liquidityTitle(r.liquidity, r.currency)}>
                  <LiquidityDots level={r.liquidity.level} />
                </td>
              </tr>
            ))}
            {screen.data && shown.length === 0 && (
              <tr>
                <td className="left muted" colSpan={10}>
                  {all.length === 0 ? "No data yet." : "No bonds match the filters."}
                </td>
              </tr>
            )}
          </tbody>
        </StickyTable>
      )}
      <p className="muted catalyst-foot">
        * Floating coupons at the assumed base rate (the cog). Jobs and their last runs: <a href="#/status">Status</a>.
      </p>

      {selected && (
        <ChartPanel title={<BondTitle r={selected} />} onClose={closePanel} onHeight={setPanelHeight}>
          <BondPanel row={selected} tab={params["tab"] ?? "price"} setTab={(t) => setParams({ ...params, tab: t === "price" ? undefined : t })} />
        </ChartPanel>
      )}
    </div>
  );
}

/** The liquidity measures in a line, statements separated by " • ". */
