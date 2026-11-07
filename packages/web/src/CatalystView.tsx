import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { apiSend } from "./api.ts";
import { ChartPanel } from "./ChartPanel.tsx";
import { FilterBar, FilterSelect, FilterText, FilterToggle, matchesAny, type Option } from "./Filters.tsx";
import { fmtInt, fmtNum, fmtPct } from "./format.ts";
import { Icon } from "./Icons.tsx";
import { SkeletonRows } from "./Placeholders.tsx";
import { parseSort, sortParam, sortRows, type SortValue } from "./sort.ts";
import { SortTh } from "./SortTh.tsx";
import { StickyTable, useStickyToolbar } from "./sticky.tsx";
import { useApi } from "./useApi.ts";
import { chartMargin, useNarrow } from "./useNarrow.ts";

// --- API shapes (packages/jobs/src/catalyst/handlers/api.ts) -----------------------------------------------------

type Level = "high" | "medium" | "low" | "none";
interface Liquidity {
  level: Level;
  traded30: number;
  traded90: number;
  medianTurnover30: number | null;
  trades30: number;
  medianSpread30: number | null;
  bid: { price: number; volume: number } | null;
  daysToSell10k: number | null;
}
interface Coupon {
  kind: "FIXED" | "FLOATING" | "ZERO" | "OTHER";
  base?: string;
  margin?: number;
  rate?: number;
}
interface BondRow {
  isin: string;
  code: string;
  segment: string;
  currency: string;
  markets: string[];
  maturity: string | null;
  nominal: number | null;
  issuer?: string | null;
  coupon?: Coupon;
  couponText?: string | null;
  secured?: boolean | null;
  issueAmount?: number | null;
  date: string;
  market: string;
  price: number | null;
  lastTraded: string | null;
  accruedInterest: number | null;
  years: number | null;
  yieldGross: number | null;
  yieldNet: number | null;
  projected: boolean;
  alternative: { label: string; yieldNet: number } | null;
  vsAlternative: number | null;
  premium: number | null;
  premiumBasis: "fixed-curve" | "wz" | null;
  liquidity: Liquidity;
  flags: string[];
}
interface CurvePoint {
  years: number;
  value: number;
  code: string;
}
interface Screen {
  date: string | null;
  computedAt: string | null;
  curve: { fixed: CurvePoint[]; wz: CurvePoint[] } | null;
  rows: BondRow[];
}
interface Assumptions {
  cpi: number;
  wibor: number;
  nbpRate: number;
  wiron: number;
  euribor: number;
  alternative: "retail" | "rate";
  altRate?: number;
  commission?: number;
}
interface AssumptionsAnswer {
  assumptions: Assumptions;
  defaults: Assumptions;
  saved: Partial<Assumptions> | null;
  offers: { series: string; kind: string; termMonths: number; firstRate: number | null; margin: number | null }[];
}
interface SavedView {
  name: string;
  params: Record<string, string>;
}
interface BondDetail {
  bond: { isin: string; code: string; maturity: string | null; firstSeen: string; markets: string[] };
  terms: { issuer?: string; series?: string; couponText?: string; secured?: boolean; issueValue?: { amount: number; currency: string; nominal: number }; periodsProblem?: string } | null;
  coupons: { start: string; end: string; recordDate?: string; paymentDate: string; rate?: number }[];
  market: string;
  sessions: { date: string; close: number | null; trades: number; turnover: number; nominal: number | null }[];
  quotes: { date: string; bid?: { price: number }; ask?: { price: number } }[];
}

// --- labels and formats ------------------------------------------------------------------------------------------

const SEGMENTS: Record<string, string> = {
  corporate: "Corporate",
  municipal: "Municipal",
  treasury: "Treasury",
  "mortgage-covered": "Covered (mortgage)",
  "public-covered": "Covered (public)",
  cooperative: "Co-operative",
  bank: "Bank",
  convertible: "Convertible",
  other: "Other",
};
const LEVELS: Level[] = ["none", "low", "medium", "high"];
const LEVEL_LABEL: Record<Level, string> = { high: "high", medium: "medium", low: "low", none: "none" };
const FLAG_LABEL: Record<string, string> = {
  stale: "stale",
  "new-listing": "new",
  "no-terms": "no terms yet",
  "no-periods": "no periods",
  "periods-extended": "periods extended",
  amortising: "amortising",
  "matures-soon": "matures soon",
  indexed: "indexed",
};
const FLAG_TITLE: Record<string, string> = {
  stale: "No trade in the last 30 sessions: the price is the exchange's reference price; no premium",
  "new-listing": "Listed under 10 sessions ago: its liquidity rests on a few days",
  "no-terms": "obligacje.pl not read yet (new bonds: within a week) or no page for it: no yield",
  "no-periods": "obligacje.pl's interest periods don't add up: no yield",
  "periods-extended": "obligacje.pl lists the periods only up to the current one: the rest repeat its length to maturity (projected)",
  amortising: "Part of the nominal has been repaid (instalments)",
  "matures-soon": "Under 90 days to maturity: an annualised yield says nothing",
  indexed: "Inflation-indexed (IZ): not computed here",
};

const pct = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : `${fmtNum(v * 100, d)} %`);
const pp = (v: number | null | undefined) => (v === null || v === undefined ? "–" : fmtPct(v * 100));
const couponLabel = (r: BondRow) => {
  const c = r.coupon;
  if (!c) return r.segment === "treasury" && /^(DS|PS|WS)\d/.test(r.code) ? "fixed" : r.segment === "treasury" && /^OK\d/.test(r.code) ? "zero" : "–";
  if (c.kind === "FIXED") return c.rate !== undefined ? `${fmtNum(c.rate * 100)} %` : "fixed";
  if (c.kind === "FLOATING") return `${(c.base ?? "").replace("WIBOR ", "W")}+${fmtNum((c.margin ?? 0) * 100)}`;
  if (c.kind === "ZERO") return "zero";
  return "–";
};
const baseOf = (r: BondRow) => (r.coupon?.kind === "FLOATING" ? (r.coupon.base ?? "other") : r.coupon?.kind === "FIXED" || /^(DS|PS|WS)\d/.test(r.code) ? "fixed" : r.coupon?.kind === "ZERO" || /^OK\d/.test(r.code) ? "zero" : "");

const SORT_KEYS = ["bond", "issuer", "type", "coupon", "maturity", "price", "yield", "vsalt", "premium", "liquidity"] as const;
function sortValue(r: BondRow, key: string): SortValue {
  switch (key) {
    case "bond":
      return r.code;
    case "issuer":
      return r.issuer ?? null;
    case "type":
      return SEGMENTS[r.segment] ?? r.segment;
    case "coupon":
      return r.coupon?.kind === "FLOATING" ? (r.coupon.margin ?? null) : (r.coupon?.rate ?? null);
    case "maturity":
      return r.years;
    case "price":
      return r.price;
    case "yield":
      return r.yieldNet;
    case "vsalt":
      return r.vsAlternative;
    case "premium":
      return r.premium;
    case "liquidity":
      return LEVELS.indexOf(r.liquidity.level) * 1e9 + (r.liquidity.medianTurnover30 ?? 0);
  }
  return null;
}

// --- filters (in the URL) ----------------------------------------------------------------------------------------

const MATURITIES: Option[] = [
  { value: "0-1", label: "Up to 1 y" },
  { value: "1-3", label: "1–3 y" },
  { value: "3-5", label: "3–5 y" },
  { value: "5-", label: "Over 5 y" },
];
const NOMINALS: Option[] = [
  { value: "100", label: "≤ 100" },
  { value: "1000", label: "≤ 1 000" },
  { value: "10000", label: "≤ 10 000" },
];
const LIQUIDITY: Option[] = [
  { value: "low", label: "Low or better" },
  { value: "medium", label: "Medium or better" },
  { value: "high", label: "High" },
];
const MIN_YIELD: Option[] = ["3", "4", "5", "6", "7", "8"].map((v) => ({ value: v, label: `≥ ${v} % net` }));
const MIN_PREMIUM: Option[] = ["0", "1", "2", "3", "5"].map((v) => ({ value: v, label: `≥ ${v} pp` }));
/** The URL parameters that are filters (a saved view keeps these and the sort). */
const FILTER_KEYS = ["q", "type", "cur", "base", "mat", "nom", "liq", "yield", "prem", "stale", "sort"] as const;

function matches(r: BondRow, p: Record<string, string>): boolean {
  if (p["q"] && !matchesAny(p["q"], r.code, r.issuer ?? undefined, r.isin)) return false;
  if (p["type"] && r.segment !== p["type"]) return false;
  if (p["cur"] && r.currency !== p["cur"]) return false;
  if (p["base"] && baseOf(r) !== p["base"]) return false;
  if (p["mat"]) {
    const [lo, hi] = p["mat"].split("-").map((x) => (x === "" ? undefined : Number(x)));
    if (r.years === null || (lo !== undefined && r.years < lo) || (hi !== undefined && r.years > hi)) return false;
  }
  if (p["nom"] && (r.nominal === null || r.nominal > Number(p["nom"]))) return false;
  if (p["liq"] && LEVELS.indexOf(r.liquidity.level) < LEVELS.indexOf(p["liq"] as Level)) return false;
  if (p["yield"] && (r.yieldNet === null || r.yieldNet * 100 < Number(p["yield"]))) return false;
  if (p["prem"] && (r.premium === null || r.premium * 100 < Number(p["prem"]))) return false;
  if (!p["stale"] && r.flags.includes("stale")) return false;
  return true;
}

/** Distinct values as filter options, sorted. */
const opt = (values: string[], label: (v: string) => string = (v) => v): Option[] => [...new Set(values)].sort().map((v) => ({ value: v, label: label(v) }));

// --- the view ----------------------------------------------------------------------------------------------------

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
              <SortTh label="Yield net" sortKey="yield" sort={sort} onSort={(s) => set("sort", sortParam(s))} firstDesc title="Yield to maturity after 19 % tax and the commission" />
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
                <td title={liquidityTitle(r.liquidity)}>
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

function liquidityTitle(l: Liquidity): string {
  const parts = [
    `traded on ${Math.round(l.traded30 * 100)} % of the last 30 sessions (${Math.round(l.traded90 * 100)} % of 90)`,
    l.medianTurnover30 !== null ? `median turnover ${fmtInt(Math.round(l.medianTurnover30))}` : "",
    l.medianSpread30 !== null ? `bid–ask spread ${fmtNum(l.medianSpread30)} pp` : "",
    l.daysToSell10k !== null ? `selling 10 000 ≈ ${l.daysToSell10k} sessions` : "",
  ];
  return `${LEVEL_LABEL[l.level]}: ${parts.filter(Boolean).join("; ")}`;
}

function LiquidityDots({ level }: { level: Level }) {
  const n = LEVELS.indexOf(level);
  return (
    <span className="cat-liq" role="img" aria-label={`liquidity ${level}`} data-level={level}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

function BondTitle({ r }: { r: BondRow }) {
  return (
    <span data-testid="catalyst-panel-title">
      <strong>{r.code}</strong> {r.issuer ?? ""} <span className="muted">{r.couponText ?? couponLabel(r)} · matures {r.maturity ?? "–"}</span>
    </span>
  );
}

// --- the chart: yield against years to maturity ------------------------------------------------------------------

const LEVEL_COLOR: Record<Level, string> = { high: "var(--pos)", medium: "var(--accent)", low: "var(--muted)", none: "var(--border)" };

function YieldChart({ rows, curve, onPick }: { rows: BondRow[]; curve: CurvePoint[]; onPick: (isin: string) => void }) {
  const narrow = useNarrow();
  const points = rows
    .filter((r) => r.years !== null && r.yieldGross !== null && r.currency === "PLN" && r.yieldGross < 0.3)
    .map((r) => ({ x: r.years!, y: r.yieldGross! * 100, isin: r.isin, code: r.code, level: r.liquidity.level }));
  const maxX = Math.min(12, Math.ceil(Math.max(1, ...points.map((p) => p.x))));
  // The curve as far as the bonds go (its long end would stretch the axis), with its value at the axis' end.
  const inside = curve.filter((p) => p.years <= maxX);
  const beyond = curve.find((p) => p.years > maxX);
  const line = [...inside, ...(beyond ? [beyond] : [])].map((p) => ({ x: Math.min(p.years, maxX), curve: p.value * 100 }));
  return (
    <section className="panel catalyst-chart" data-testid="catalyst-chart">
      <p className="muted chart-legend">Yield to maturity before tax against years to maturity (PLN bonds); the line: the State's fixed-rate bonds. Dots by liquidity.</p>
      <ResponsiveContainer width="100%" height={narrow ? 260 : 340}>
        <ComposedChart margin={chartMargin(narrow)}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis type="number" dataKey="x" domain={[0, maxX]} unit=" y" allowDecimals={false} allowDataOverflow allowDuplicatedCategory={false} />
          <YAxis type="number" unit=" %" domain={["auto", "auto"]} width={narrow ? 40 : 48} />
          <Tooltip
            content={({ payload }) => {
              const p = payload?.[0]?.payload as { code?: string; x: number; y?: number; curve?: number } | undefined;
              if (!p) return null;
              return (
                <div className="chart-tip">
                  {p.code ? `${p.code}: ${fmtNum(p.y ?? 0)} % at ${fmtNum(p.x, 1)} y` : `State: ${fmtNum(p.curve ?? 0)} % at ${fmtNum(p.x, 1)} y`}
                </div>
              );
            }}
          />
          <Line data={line} dataKey="curve" type="monotone" stroke="var(--fg)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Scatter
            data={points}
            dataKey="y"
            isAnimationActive={false}
            onClick={(d: { isin?: string; payload?: { isin: string } }) => onPick(d.payload?.isin ?? d.isin ?? "")}
            shape={(props: { cx?: number; cy?: number; payload?: { level: Level } }) => <circle cx={props.cx} cy={props.cy} r={4} fill={LEVEL_COLOR[props.payload?.level ?? "none"]} style={{ cursor: "pointer" }} />}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </section>
  );
}

// --- a bond's panel ----------------------------------------------------------------------------------------------

function BondPanel({ row, tab, setTab }: { row: BondRow; tab: string; setTab: (t: string) => void }) {
  const detail = useApi<BondDetail>(`/catalyst/bonds/${row.isin}`);
  const d = detail.data;
  return (
    <div className="catalyst-panel">
      <div className="segmented cat-tabs" role="tablist">
        {[
          ["price", "Price & liquidity"],
          ["yield", "Yield"],
          ["coupons", "Coupons"],
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
    </div>
  );
}

function PriceTab({ row, detail, loading }: { row: BondRow; detail: BondDetail | undefined; loading: boolean }) {
  const narrow = useNarrow();
  if (!detail) return <p className="muted">{loading ? "Loading…" : ""}</p>;
  const quotes = new Map(detail.quotes.map((q) => [q.date, q]));
  const data = detail.sessions.map((s) => ({ date: s.date, close: s.trades > 0 ? s.close : null, reference: s.close, turnover: s.turnover, bid: quotes.get(s.date)?.bid?.price ?? null, ask: quotes.get(s.date)?.ask?.price ?? null }));
  const l = row.liquidity;
  return (
    <div className="cat-price">
      <p className="muted cat-facts" data-testid="catalyst-liquidity">
        {liquidityTitle(l)}
        {l.bid ? `; best bid ${fmtNum(l.bid.price)} for ${fmtInt(l.bid.volume)} bonds` : ""}. Market {detail.market}.
      </p>
      <div className="cat-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={chartMargin(narrow)}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} minTickGap={30} />
          {/* Whole percents: "auto" picks fractional ticks (101.25) that don't fit the axis once prices pass 100. */}
          <YAxis yAxisId="p" domain={[(min: number) => Math.floor(min), (max: number) => Math.ceil(max)]} allowDecimals={false} tickFormatter={(v: number) => fmtInt(v)} width={narrow ? 36 : 44} />
          <YAxis yAxisId="t" orientation="right" hide />
          <Tooltip formatter={(v, name) => [name === "turnover" ? fmtInt(Math.round(Number(v))) : fmtNum(Number(v)), String(name)]} />
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

function YieldTab({ row, detail }: { row: BondRow; detail: BondDetail | undefined }) {
  const t = detail?.terms;
  const items: [string, string][] = [
    ["Price", row.price === null ? "–" : `${fmtNum(row.price)} % of ${fmtInt(row.nominal ?? 0)} ${row.currency} (session ${row.date}${row.lastTraded && row.lastTraded !== row.date ? `; last trade ${row.lastTraded}` : ""})`],
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
      <p className="muted">Bought at the session's price + accrued interest + commission, held to maturity, coupons reinvested at the same yield; tax 19 % on coupons (less the accrued interest paid) and on the gain at maturity. A corporate bond's yield is what's promised; the premium is the pay for the issuer's risk.</p>
    </dl>
  );
}

function CouponsTab({ detail, loading }: { detail: BondDetail | undefined; loading: boolean }) {
  if (!detail) return <p className="muted">{loading ? "Loading…" : ""}</p>;
  if (detail.coupons.length === 0) return <p className="muted">{detail.terms?.periodsProblem ? `obligacje.pl's periods don't add up: ${detail.terms.periodsProblem}.` : "No interest periods (terms not read yet, or a treasury series: yearly coupons)."}</p>;
  return (
    <div className="table-wrap">
      <table className="static" data-testid="catalyst-coupons">
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
            <tr key={c.start}>
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

// --- saved views -------------------------------------------------------------------------------------------------

function ViewsMenu({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const views = useApi<{ views: SavedView[] }>("/catalyst/views");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = views.data?.views ?? [];
  const current = Object.fromEntries(FILTER_KEYS.filter((k) => params[k]).map((k) => [k, params[k]!]));
  const save = async (next: SavedView[]) => {
    setError(null);
    try {
      await apiSend("PUT", "/catalyst/views", { views: next });
      views.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const same = (v: SavedView) => JSON.stringify(v.params) === JSON.stringify(current);
  // The view in use: the one chosen (`view` in the URL), even after its filters changed, or one that matches them.
  const active = list.find((v) => v.name === params["view"]) ?? list.find(same);
  const changed = active !== undefined && !same(active);
  return (
    <span className="cat-views">
      <FilterSelect
        label="View"
        value={active?.name ?? ""}
        options={list.map((v) => ({ value: v.name, label: v === active && changed ? `${v.name} (changed)` : v.name }))}
        onChange={(v) => {
          const view = list.find((x) => x.name === v);
          setParams({ ...(view?.params ?? {}), view: view?.name, bond: params["bond"], chart: params["chart"] });
        }}
        testId="catalyst-view"
        width="9rem"
      />
      {naming ? (
        <form
          className="cat-view-name"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void save([...list.filter((v) => v.name !== n), { name: n, params: current }]).then(() => {
              setNaming(false);
              setName("");
              setParams({ ...params, view: n });
            });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" maxLength={60} data-testid="catalyst-view-name" />
          <button type="submit" className="link" data-testid="catalyst-view-save">
            Save
          </button>
          <button type="button" className="link" onClick={() => setNaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {active && changed && (
            <button type="button" className="link" onClick={() => void save(list.map((v) => (v === active ? { name: v.name, params: current } : v)))} title={`Save these filters and the sort into the view "${active.name}"`} data-testid="catalyst-view-update">
              Save changes
            </button>
          )}
          <button type="button" className="link" onClick={() => setNaming(true)} title="Save these filters and the sort as a new view" data-testid="catalyst-view-new">
            {active ? "Save as…" : "Save view"}
          </button>
        </>
      )}
      {active && !naming && (
        <button
          type="button"
          className="link"
          onClick={() => void save(list.filter((v) => v !== active)).then(() => setParams({ ...params, view: undefined }))}
          title={`Delete the view "${active.name}"`}
          data-testid="catalyst-view-delete"
        >
          Delete
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </span>
  );
}

// --- the assumptions ---------------------------------------------------------------------------------------------

type Draft = Record<"cpi" | "wibor" | "nbpRate" | "wiron" | "euribor" | "altRate" | "commission", string> & { alternative: "retail" | "rate" };
const show = (v: number | undefined) => (v === undefined ? "" : fmtNum(v * 100));
const parse = (s: string) => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return s.trim() === "" ? undefined : Number.isFinite(n) ? n / 100 : Number.NaN;
};

function AssumptionsPanel({ onSaved }: { onSaved: () => void }) {
  const data = useApi<AssumptionsAnswer>("/catalyst/settings/assumptions");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const a = data.data?.assumptions;
  useEffect(() => {
    if (a) setDraft({ cpi: show(a.cpi), wibor: show(a.wibor), nbpRate: show(a.nbpRate), wiron: show(a.wiron), euribor: show(a.euribor), altRate: show(a.altRate), commission: show(a.commission), alternative: a.alternative });
  }, [a]);
  const send = async (body: unknown, done: string) => {
    setPending(true);
    setError(null);
    try {
      await apiSend("PUT", "/catalyst/settings/assumptions", body);
      data.reload();
      setMessage(done);
      // The worker recomputes the screen in about a quarter of a minute.
      window.setTimeout(onSaved, 20_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const field = (key: keyof Omit<Draft, "alternative">, label: string, title: string, placeholder = "") =>
    draft && (
      <label className="hs-field" title={title}>
        <span className="muted">{label}</span>
        <span className="with-unit">
          <input inputMode="decimal" value={draft[key]} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} data-testid={`catalyst-${key}`} />
          <span className="muted">%</span>
        </span>
      </label>
    );
  return (
    <section className="panel hs-assumptions" data-testid="catalyst-assumptions">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft) return;
          const body = {
            cpi: parse(draft.cpi),
            wibor: parse(draft.wibor),
            nbpRate: parse(draft.nbpRate),
            wiron: parse(draft.wiron),
            euribor: parse(draft.euribor),
            alternative: draft.alternative,
            ...(draft.alternative === "rate" ? { altRate: parse(draft.altRate) } : {}),
            ...(parse(draft.commission) !== undefined ? { commission: parse(draft.commission) } : {}),
          };
          if ([body.cpi, body.wibor, body.nbpRate, body.wiron, body.euribor].some((v) => v === undefined || Number.isNaN(v))) return setError("Each rate needs a number (in %).");
          void send(body, "Saved: the yields are being recomputed (about 20 s).");
        }}
      >
        {field("wibor", "WIBOR", "WIBOR 3M/6M from now on: floating coupons not set yet (WIBOR + margin)")}
        {field("wiron", "WIRON", "WIRON and POLSTR from now on (the NZ series, newer floating bonds)")}
        {field("euribor", "EURIBOR", "EURIBOR from now on (EUR floating bonds)")}
        {field("cpi", "CPI", "Inflation y/y from now on: the retail alternatives after their first year (COI, EDO)")}
        {field("nbpRate", "NBP rate", "NBP reference rate: ROR and DOR as the alternative")}
        {draft && (
          <label className="hs-field" title="What the money would go into instead, until the bond's maturity">
            <span className="muted">Alternative</span>
            <select value={draft.alternative} onChange={(e) => setDraft({ ...draft, alternative: e.target.value as Draft["alternative"] })} data-testid="catalyst-alternative">
              <option value="retail">Retail bond on offer</option>
              <option value="rate">A rate (before tax)</option>
            </select>
          </label>
        )}
        {draft?.alternative === "rate" && field("altRate", "Rate", "The alternative's annual rate before tax")}
        {field("commission", "Commission", "A purchase's commission, % of its value", fmtNum((data.data?.defaults.commission ?? 0.0019) * 100))}
        <span className="hs-buttons">
          <button type="submit" className="primary" disabled={pending || !draft} data-testid="catalyst-assumptions-save">
            {pending && <span className="spinner" aria-hidden />}
            Save
          </button>
          {data.data?.saved && (
            <button type="button" className="link" disabled={pending} onClick={() => void send({ reset: true }, "Back to the defaults: the yields are being recomputed (about 20 s).")} data-testid="catalyst-assumptions-reset">
              Defaults
            </button>
          )}
        </span>
      </form>
      {message && !error && (
        <p className="muted" role="status" data-testid="catalyst-assumptions-done">
          {message}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {data.data && data.data.offers.length > 0 && (
        <p className="muted hs-offers">On offer: {data.data.offers.map((o) => `${o.series} (${o.termMonths >= 12 ? `${o.termMonths / 12} y` : `${o.termMonths} m`}) ${o.firstRate === null ? "" : pct(o.firstRate)}`).join(" · ")}</p>
      )}
    </section>
  );
}
