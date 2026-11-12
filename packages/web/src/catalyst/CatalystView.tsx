// The Catalyst view (Docs/ui.md, "Catalyst"): the bond table, its filters, the chart and the panel.
import { useCallback, useMemo, useState } from "react";
import { ChartPanel } from "../ChartPanel.tsx";
import { FilterBar, FilterSelect, FilterText, FilterToggle } from "../Filters.tsx";
import { fmtNum } from "../format.ts";
import { Icon } from "../Icons.tsx";
import { InfoTip } from "../InfoTip.tsx";
import { SkeletonRows } from "../Placeholders.tsx";
import { parseSort, sortParam, sortRows, type Sort } from "../sort.ts";
import { SortTh } from "../SortTh.tsx";
import { StickyTable, useStickyToolbar } from "../sticky.tsx";
import { useApi } from "../useApi.ts";
import { useNarrow } from "../useNarrow.ts";
import type { BondRow, Screen } from "./types.ts";
import { FLAG_LABEL, FLAG_TITLE, SEGMENTS, SORT_KEYS, baseOf, couponLabel, liquidityTitle, pct, pp, sortValue } from "./labels.ts";
import { FILTER_KEYS, LIQUIDITY, MATURITIES, MIN_PREMIUM, MIN_YIELD, NOMINALS, companyList, companyName, companyParam, inList, matches, opt, toggleCompany } from "./filters.ts";
import { CompaniesFilter, companiesOf } from "./CompaniesFilter.tsx";
import { BondTitle, LiquidityDots } from "./parts.tsx";
import { YieldChart } from "./YieldChart.tsx";
import { BondPanel } from "./BondPanel.tsx";
import { ViewsMenu } from "./ViewsMenu.tsx";
import { AgentTokenPanel } from "./AgentTokenPanel.tsx";
import { AssumptionsPanel } from "./AssumptionsPanel.tsx";
import { CatalystTabs } from "./CatalystTabs.tsx";
import { CONFIDENCE_FILTERS, DIMENSIONS, IssuerSignalsCell, RULE_SETS, SCORECARD_FILTERS, STATE_FILTERS } from "./issuer.tsx";
import { IssuerDialog } from "./IssuerDialog.tsx";

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
  // Without a sort in the URL: the view's own order, the best net yield first, marked on its column.
  const sort = parseSort(params["sort"], SORT_KEYS) ?? DEFAULT_SORT;
  const set = (k: string, v: string | undefined) => setParams({ ...params, [k]: v || undefined });
  const list = companyList(params);
  const out = params["cm"] === "out";
  // "Only these" companies: the other companies' bonds that pass the other filters (shown greyed on "Show").
  const others = useMemo(() => {
    const listed = companyList(params);
    return listed.length && params["cm"] !== "out" ? all.filter((r) => !inList(r, listed) && matches(r, { ...params, co: "" })) : [];
  }, [all, params]);
  const peek = !!params["peek"] && others.length > 0;
  const shown = useMemo(() => {
    const filtered = all.filter((r) => matches(r, params) || (peek && others.includes(r)));
    // Ties keep the view's own order: the best net yield first, those without one after.
    const byYield = sortRows(filtered, DEFAULT_SORT, sortValue);
    return sortRows(byYield, sort, sortValue);
  }, [all, params, sort, peek, others]);
  const selected = params["bond"] ? all.find((r) => r.isin === params["bond"]) : undefined;
  const closeDialog = useCallback(() => setParams({ ...params, issuer: undefined, itab: undefined }), [params, setParams]);
  const openIssuer = (r: BondRow) => r.entityId && setParams({ ...params, issuer: r.entityId });
  const industries = useMemo(() => opt(all.map((r) => r.industry ?? "").filter(Boolean)), [all]);
  const rules = useMemo(() => opt(all.map((r) => r.scorecard?.ruleSet ?? "").filter(Boolean), (v) => RULE_SETS[v] ?? v), [all]);
  const companies = useMemo(() => companiesOf(all), [all]);
  // A row's company on the view's list, or off it: ＋ by its name, the issuer dialog.
  const toggleCompanyOf = (r: BondRow) => {
    const next = toggleCompany(r, list);
    setParams({ ...params, co: companyParam(next), cm: next.length ? params["cm"] : undefined });
  };
  const companyTitle = (r: BondRow) => {
    const name = companyName(r);
    if (out) return `Hide ${name}'s bonds in this view`;
    if (inList(r, list)) return `${name} is in this view's companies: click to take it off`;
    return list.length ? `Add ${name} to this view's companies` : `Show only ${name}'s bonds (this view's companies)`;
  };
  const closePanel = useCallback(() => setParams({ ...params, bond: undefined }), [params, setParams]);
  const types = useMemo(() => opt(all.map((r) => r.segment), (v) => SEGMENTS[v] ?? v), [all]);
  const currencies = useMemo(() => opt(all.map((r) => r.currency)), [all]);
  const bases = useMemo(() => opt(all.map(baseOf).filter(Boolean), (v) => (v === "fixed" ? "Fixed" : v === "zero" ? "Zero coupon" : v)), [all]);
  const activeFilters = FILTER_KEYS.filter((k) => k !== "sort" && k !== "stale" && k !== "cm" && params[k]).length;
  // Stale bonds the other filters would show (hidden unless "Show stale").
  const staleCount = useMemo(() => all.filter((r) => r.flags.includes("stale") && matches(r, { ...params, stale: "1" })).length, [all, params]);
  const toggleRow = (r: BondRow) => setParams({ ...params, bond: params["bond"] === r.isin ? undefined : r.isin });

  return (
    <div className="cat-view" style={{ ...stickyStyle, paddingBottom: panelHeight }}>
      <header className="view-header cat-header">
        <h2 className="view-title">Catalyst</h2>
        <CatalystTabs current="bonds" />
        <ViewsMenu params={params} setParams={setParams} />
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
      {settingsOpen && (
        <>
          <AssumptionsPanel onSaved={screen.reload} />
          <AgentTokenPanel />
        </>
      )}

      <div className="sticky-toolbar" ref={toolbar} data-testid="catalyst-toolbar">
        <FilterBar
          compact
          activeCount={activeFilters}
          search={<FilterText label="Bond" value={params["q"] ?? ""} onChange={(v) => set("q", v)} placeholder="Code or issuer" testId="catalyst-q" />}
          active={activeFilters > 0}
          onReset={() => setParams({ sort: params["sort"], bond: params["bond"], stale: params["stale"], dots: params["dots"] })}
          summary={screen.loading && !screen.data ? "Loading…" : `${shown.length} of ${all.length} bonds${!params["stale"] && staleCount ? ` (+ ${staleCount} stale, hidden)` : ""}`}
          after={
            <>
              <FilterToggle label="Show stale" checked={!!params["stale"]} onChange={(on) => set("stale", on ? "1" : undefined)} testId="catalyst-stale" title="Also the bonds without a trade in the last 30 sessions" />
              <FilterToggle label="Chart" checked={!!params["chart"]} onChange={(on) => set("chart", on ? "1" : undefined)} testId="catalyst-chart-toggle" title="Yield against years to maturity, with the State's curve" />
            </>
          }
        >
          <FilterSelect label="Type" value={params["type"] ?? ""} options={types} onChange={(v) => set("type", v)} testId="catalyst-type" width="10rem" />
          <FilterSelect label="Coupon" value={params["base"] ?? ""} options={bases} onChange={(v) => set("base", v)} testId="catalyst-base" width="9rem" />
          <FilterSelect label="Maturity" value={params["mat"] ?? ""} options={MATURITIES} onChange={(v) => set("mat", v)} testId="catalyst-mat" width="8rem" />
          <FilterSelect label="Nominal" value={params["nom"] ?? ""} options={NOMINALS} onChange={(v) => set("nom", v)} testId="catalyst-nom" width="7rem" />
          <FilterSelect label="Liquidity" value={params["liq"] ?? ""} options={LIQUIDITY} onChange={(v) => set("liq", v)} testId="catalyst-liq" width="11rem" />
          <FilterSelect label="Yield" value={params["yield"] ?? ""} options={MIN_YIELD} onChange={(v) => set("yield", v)} testId="catalyst-yield" width="8rem" />
          <FilterSelect label="Premium" value={params["prem"] ?? ""} options={MIN_PREMIUM} onChange={(v) => set("prem", v)} testId="catalyst-prem" width="7rem" />
          <FilterSelect label="Currency" value={params["cur"] ?? ""} options={currencies} onChange={(v) => set("cur", v)} testId="catalyst-cur" width="6rem" />
          <FilterSelect label="Scorecard" value={params["sc"] ?? ""} options={SCORECARD_FILTERS} onChange={(v) => set("sc", v)} testId="catalyst-sc" width="12rem" />
          <FilterSelect label="Analysis" value={params["state"] ?? ""} options={STATE_FILTERS} onChange={(v) => set("state", v)} testId="catalyst-state" width="9rem" />
          <FilterSelect label="Confidence" value={params["conf"] ?? ""} options={CONFIDENCE_FILTERS} onChange={(v) => set("conf", v)} testId="catalyst-conf" width="9rem" />
          <FilterSelect label="AI analysis" value={params["ai"] ?? ""} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} onChange={(v) => set("ai", v)} testId="catalyst-ai" width="7rem" />
          <FilterSelect label="Industry" value={params["ind"] ?? ""} options={industries} onChange={(v) => set("ind", v)} testId="catalyst-ind" width="10rem" />
          <FilterSelect label="Rules" value={params["rule"] ?? ""} options={rules} onChange={(v) => set("rule", v)} testId="catalyst-rule" width="10rem" />
          <CompaniesFilter companies={companies} params={params} setParams={setParams} />
        </FilterBar>
      </div>

      {others.length > 0 && (
        <p className="muted cat-others" data-testid="catalyst-others">
          {others.length === 1 ? "1 bond" : `${others.length} bonds`} from other companies {others.length === 1 ? "matches" : "match"} the other filters ·{" "}
          <button type="button" className="link-button" onClick={() => set("peek", peek ? undefined : "1")} data-testid="catalyst-others-toggle">
            {peek ? "Hide" : "Show"}
          </button>
        </p>
      )}

      {params["chart"] && screen.data && (
        <YieldChart rows={shown} curve={screen.data.curve?.fixed ?? []} onPick={(isin) => setParams({ ...params, bond: isin })} dots={params["dots"] ?? "S"} setDots={(v) => set("dots", v === "S" ? undefined : v)} />
      )}

      {narrow ? (
        <ul className="hs-list panel catalyst-list" data-testid="catalyst-table">
          {!screen.data && screen.loading && <li className="muted">Loading…</li>}
          {shown.map((r) => (
            <li key={r.isin} className={[r.isin === params["bond"] ? "selected" : "", peek && others.includes(r) ? "outside" : ""].filter(Boolean).join(" ")} data-testid="catalyst-row" data-code={r.code}>
              <button type="button" className="cat-row" onClick={() => toggleRow(r)} aria-expanded={r.isin === params["bond"]}>
              <div className="cat-line">
                <strong>{r.code}</strong> <span className="muted">{r.issuerShort ?? r.issuer ?? ""}</span>
                <LiquidityDots level={r.liquidity.level} />
              </div>
              <div className="cat-line muted">
                {couponLabel(r)} · {r.years === null ? "–" : `${fmtNum(r.years, 1)} y`} · {r.price === null ? "–" : fmtNum(r.price)}
              </div>
              {r.entityId && (
                <div className="cat-line">
                  <IssuerSignalsCell ai={r.aiAnalysis} signals={r.scorecard} offSince={r.aiOffSince} />
                </div>
              )}
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
              <SortTh label="Scorecard" sortKey="scorecard" sort={sort} onSort={(s) => set("sort", sortParam(s))} className="left" firstDesc title={`The company's scorecard: ${DIMENSIONS.map((d) => d.label.toLowerCase()).join(", ")}; trend arrows, rule set, confidence`} />
              <SortTh label="Coupon" sortKey="coupon" sort={sort} onSort={(s) => set("sort", sortParam(s))} className="left" firstDesc />
              <SortTh label="Maturity" sortKey="maturity" sort={sort} onSort={(s) => set("sort", sortParam(s))} />
              <SortTh label="Price" sortKey="price" sort={sort} onSort={(s) => set("sort", sortParam(s))} />
              <SortTh label="Yield net" sortKey="yield" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc info={<InfoTip label="yield net" testId="info-yield">{INFO.yield}</InfoTip>} />
              <SortTh label="Vs alt." sortKey="vsalt" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc info={<InfoTip label="vs alt." testId="info-vsalt">{INFO.vsalt}</InfoTip>} />
              <SortTh label="Premium" sortKey="premium" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc info={<InfoTip label="premium" testId="info-premium">{INFO.premium}</InfoTip>} />
              <SortTh label="Liquidity" sortKey="liquidity" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc />
            </tr>
          }
        >
          <tbody>
            {!screen.data && screen.loading && <SkeletonRows rows={12} cols={10} />}
            {shown.map((r) => (
              <tr key={r.isin} className={`clickable${r.isin === params["bond"] ? " selected" : ""}${r.flags.includes("stale") ? " closed" : ""}${peek && others.includes(r) ? " outside" : ""}`} onClick={() => toggleRow(r)} data-testid="catalyst-row" data-code={r.code}>
                <td className="left cat-bond" title={`${r.isin} · ${SEGMENTS[r.segment] ?? r.segment} · ${r.markets.join(", ")}`}>
                  <strong>{r.code}</strong>
                  {r.segment !== "corporate" && <span className="flag">{(SEGMENTS[r.segment] ?? r.segment).toLowerCase()}</span>}
                  {r.currency !== "PLN" && <span className="flag">{r.currency}</span>}
                  {r.flags
                    .filter((f) => FLAG_LABEL[f] && f !== "stale")
                    .map((f) => (
                      <span key={f} className="flag" title={FLAG_TITLE[f]}>
                        {FLAG_LABEL[f]}
                      </span>
                    ))}
                </td>
                <td className="left cat-issuer" title={[r.issuerLegal ?? r.issuer, r.industry].filter(Boolean).join(" · ")}>
                  {r.entityId ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openIssuer(r);
                      }}
                      data-testid="catalyst-issuer"
                    >
                      {r.issuerShort ?? r.issuer}
                    </button>
                  ) : (
                    (r.issuer ?? <span className="muted">–</span>)
                  )}
                  {companyName(r) && (
                    <button
                      type="button"
                      className={`icon-button cat-co-toggle${!out && inList(r, list) ? " on" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCompanyOf(r);
                      }}
                      title={companyTitle(r)}
                      aria-label={companyTitle(r)}
                      data-testid="catalyst-co-toggle"
                    >
                      <Icon name={out ? "eye-off" : inList(r, list) ? "check" : "plus"} size={14} />
                    </button>
                  )}
                </td>
                <td className="left cat-issuer-signals" data-testid="catalyst-scorecard">
                  {r.entityId ? (
                    <button
                      type="button"
                      className="link-button plain"
                      onClick={(e) => {
                        e.stopPropagation();
                        openIssuer(r);
                      }}
                    >
                      <IssuerSignalsCell ai={r.aiAnalysis} signals={r.scorecard} offSince={r.aiOffSince} compact />
                    </button>
                  ) : (
                    <span className="muted" title="Not linked to a company yet">
                      –
                    </span>
                  )}
                </td>
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
      {params["issuer"] && (
        <IssuerDialog
          entityId={params["issuer"]}
          rows={all}
          tab={params["itab"] ?? "bonds"}
          setTab={(t) => setParams({ ...params, itab: t === "bonds" ? undefined : t })}
          onClose={closeDialog}
          onShowBonds={() => setParams({ ...params, co: params["issuer"], cm: undefined, issuer: undefined, itab: undefined })}
          viewToggle={(() => {
            const r = all.find((x) => x.entityId === params["issuer"]);
            return r ? { label: out ? "Hide in this view" : inList(r, list) ? "In this view" : "Add to this view", on: !out && inList(r, list), title: companyTitle(r), toggle: () => toggleCompanyOf(r) } : undefined;
          })()}
        />
      )}
    </div>
  );
}

/** What the yield columns are (the "i" by their headings). */
/** The view's own order: the best net yield first. */
const DEFAULT_SORT: Sort = { key: "yield", desc: true };

const INFO = {
  yield: (
    <>
      <strong>Yield net</strong>: what the bond earns a year if bought today at its last price (plus the accrued interest and the commission) and held to maturity, after the 19% tax on coupons and on the gain. Coupons are assumed reinvested at the same yield. <em>*</em>: a floating coupon, its future rates at the base rate assumed in the settings (the cog).
    </>
  ),
  vsalt: (
    <>
      <strong>Vs alternative</strong>: net yield minus the net yield of a safe alternative over about the same time: the State's retail bond of the nearest term (e.g. TOS, COI), or the rate set in the settings. In percentage points. Above zero, the bond pays more than the safe choice; below zero, the safe choice pays more, so its risk isn't paid for.
    </>
  ),
  premium: (
    <>
      <strong>Premium</strong>: what the market pays over the State for this issuer's risk, before tax. Fixed coupon: the bond's yield minus the State's bonds' yield at the same maturity (the curve on the chart). Floating coupon: its margin, adjusted for the price, minus the margin of the State's floating bonds (WZ). Higher means more pay for more risk, or a market that doubts the issuer.
    </>
  ),
};

/** The liquidity measures in a line, statements separated by " • ". */
