// The Issuers view (Docs/catalyst.md, "Issuers"): one row per company with listed bonds, its AI analysis switch, its
// bonds' amounts and premium, its scorecard in short and its latest judgement's date. A row opens the issuer dialog.
import { useCallback, useMemo, useState } from "react";
import { apiSend } from "../api.ts";
import { FilterBar, FilterSelect, FilterText, matchesAny } from "../Filters.tsx";
import { SkeletonRows } from "../Placeholders.tsx";
import { parseSort, sortParam, sortRows, type Sort, type SortValue } from "../sort.ts";
import { SortTh } from "../SortTh.tsx";
import { StickyTable, useStickyToolbar } from "../sticky.tsx";
import { useApi } from "../useApi.ts";
import { useNarrow } from "../useNarrow.ts";
import { fmtNum } from "../format.ts";
import { CatalystTabs } from "./CatalystTabs.tsx";
import { ChecklistTab } from "./ChecklistTab.tsx";
import { CONFIDENCE_FILTERS, IssuerSignalsCell, RULE_SETS, SCORECARD_FILTERS, STATE_FILTERS, confidenceAtLeast, scorecardMatches, signalsScore, stateMatches } from "./issuer.tsx";
import { IssuerDialog } from "./IssuerDialog.tsx";
import { pp } from "./labels.ts";
import { opt } from "./filters.ts";
import type { AiSwitch, BondRow, CompanyListItem, IssuerSignals, Screen, WorkItem } from "./types.ts";

interface IssuerRow {
  c: CompanyListItem;
  bonds: BondRow[];
  signals: IssuerSignals | undefined;
  /** Owed on Catalyst and due within 12 months, PLN bonds only (others are listed apart). */
  owed: number;
  due12: number;
  otherCurrencies: string[];
  premium: number | null;
  /** What `catalyst work` lists for it (the agent's and yours). */
  work: WorkItem[];
}

const DEFAULT_SORT: Sort = { key: "name", desc: false };
const KEYS = ["name", "ai", "industry", "rule", "bonds", "owed", "due12", "premium", "scorecard", "confidence", "year", "judged", "work"] as const;
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mln = (v: number) => (v ? fmtNum(v / 1e6, 1) : "–");

function value(r: IssuerRow, key: string): SortValue {
  switch (key) {
    case "name":
      return r.c.shortName;
    case "ai":
      return r.c.aiAnalysis.on ? 1 : 0;
    case "industry":
      return r.c.industry;
    case "rule":
      return r.signals?.ruleSet ?? null;
    case "bonds":
      return r.bonds.length;
    case "owed":
      return r.owed;
    case "due12":
      return r.due12;
    case "premium":
      return r.premium;
    case "scorecard":
      return signalsScore(r.signals);
    case "confidence":
      return r.signals?.confidence ? ["low", "medium", "high"].indexOf(r.signals.confidence) : null;
    case "year":
      return r.signals?.latestPeriodEnd ?? null;
    case "judged":
      return r.c.judgedAt;
    case "work":
      return r.work.length;
  }
  return null;
}

export function IssuersView({ params, setParams }: { params: Record<string, string>; setParams: (p: Record<string, string | undefined>) => void }) {
  const entities = useApi<{ entities: CompanyListItem[] }>("/catalyst/entities");
  const screen = useApi<Screen>("/catalyst/bonds");
  const work = useApi<{ items: WorkItem[] }>("/catalyst/work");
  const narrow = useNarrow();
  const [toolbar, stickyStyle] = useStickyToolbar();
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string | undefined) => setParams({ ...params, [k]: v || undefined });
  // Without a sort in the URL: by name, marked on its column.
  const sort = parseSort(params["sort"], KEYS) ?? DEFAULT_SORT;

  const all = useMemo<IssuerRow[]>(() => {
    const rows = screen.data?.rows ?? [];
    return (entities.data?.entities ?? [])
      .filter((c) => c.listed > 0)
      .map((c) => {
        const bonds = rows.filter((r) => r.entityId === c.entityId);
        const pln = bonds.filter((r) => r.currency === "PLN");
        return {
          c,
          bonds,
          signals: bonds.find((r) => r.scorecard)?.scorecard,
          owed: pln.reduce((s, r) => s + (r.issueAmount ?? 0), 0),
          due12: pln.filter((r) => r.years !== null && r.years <= 1).reduce((s, r) => s + (r.issueAmount ?? 0), 0),
          otherCurrencies: [...new Set(bonds.filter((r) => r.currency !== "PLN").map((r) => r.currency))],
          premium: median(bonds.map((r) => r.premium).filter((p): p is number => p !== null)),
          work: (work.data?.items ?? []).filter((w) => w.entityId === c.entityId),
        };
      });
  }, [entities.data, screen.data, work.data]);

  const shown = useMemo(() => {
    const p = params;
    const filtered = all.filter(
      (r) =>
        (!p["q"] || matchesAny(p["q"], r.c.shortName, r.c.legalName, r.c.krs, r.c.lei, ...r.c.names, ...r.bonds.map((b) => b.code))) &&
        (!p["ai"] || (p["ai"] === "on") === r.c.aiAnalysis.on) &&
        (!p["ind"] || r.c.industry === p["ind"]) &&
        (!p["rule"] || r.signals?.ruleSet === p["rule"]) &&
        (!p["sc"] || scorecardMatches(r.signals, p["sc"])) &&
        (!p["conf"] || confidenceAtLeast(r.signals, p["conf"])) &&
        (!p["state"] || stateMatches(r.signals, r.c.aiAnalysis.on, p["state"])) &&
        (!p["work"] || (p["work"] === "you" ? r.work.some((w) => w.who === "you") : r.work.length > 0)),
    );
    return sortRows(sortRows(filtered, DEFAULT_SORT, value), sort, value);
  }, [all, params, sort]);

  const industries = useMemo(() => opt(all.map((r) => r.c.industry ?? "").filter(Boolean)), [all]);
  const rules = useMemo(() => opt(all.map((r) => r.signals?.ruleSet ?? "").filter(Boolean), (v) => RULE_SETS[v] ?? v), [all]);
  const active = ["q", "ai", "ind", "rule", "sc", "conf", "state", "work"].filter((k) => params[k]).length;
  const names = useMemo(() => new Map((entities.data?.entities ?? []).map((e) => [e.entityId, e.shortName])), [entities.data]);
  const checklist = params["tab"] === "checklist";
  const closeDialog = useCallback(() => setParams({ ...params, issuer: undefined, itab: undefined }), [params, setParams]);

  const setAi = async (c: CompanyListItem, on: boolean) => {
    setError(null);
    try {
      const res = await apiSend<{ aiAnalysis: AiSwitch }>("PUT", `/catalyst/entities/${encodeURIComponent(c.entityId)}/ai`, { on });
      entities.update((d) => (d ? { entities: d.entities.map((e) => (e.entityId === c.entityId ? { ...e, aiAnalysis: res.aiAnalysis } : e)) } : d));
      screen.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const loading = (entities.loading && !entities.data) || (screen.loading && !screen.data);
  const th = (label: string, key: (typeof KEYS)[number], opts: { left?: boolean; firstDesc?: boolean; title?: string } = {}) => (
    <SortTh label={label} sortKey={key} sort={sort} onSort={(s) => set("sort", sortParam(s))} {...(opts.left ? { className: "left" } : {})} {...(opts.firstDesc ? { firstDesc: true } : {})} {...(opts.title ? { title: opts.title } : {})} />
  );

  return (
    <div className="cat-view" style={stickyStyle}>
      <header className="view-header cat-header">
        <h2 className="view-title">Catalyst</h2>
        <CatalystTabs current="issuers" />
      </header>
      {/* biome-ignore lint/a11y/useSemanticElements: a segmented control; a <fieldset> would bring its own box and legend */}
      <div className="segmented cat-tabs cat-issuers-tabs" role="group" aria-label="Issuers or the reports checklist">
        <button type="button" className={checklist ? "" : "active"} aria-pressed={!checklist} onClick={() => setParams({ ...params, tab: undefined })} data-testid="issuers-tab-companies">
          Companies
        </button>
        <button type="button" className={checklist ? "active" : ""} aria-pressed={checklist} onClick={() => setParams({ ...params, tab: "checklist" })} data-testid="issuers-tab-checklist">
          Reports checklist
        </button>
      </div>
      {checklist && <ChecklistTab names={names} />}
      {(entities.error || screen.error || error) && <p className="error callout">{entities.error ?? screen.error ?? error}</p>}
      {!checklist && (
      <>
      <div className="sticky-toolbar" ref={toolbar} data-testid="issuers-toolbar">
        <FilterBar
          compact
          activeCount={active}
          search={<FilterText label="Company" value={params["q"] ?? ""} onChange={(v) => set("q", v)} placeholder="Name, KRS, bond" testId="issuers-q" />}
          active={active > 0}
          onReset={() => setParams({ sort: params["sort"] })}
          summary={loading ? "Loading…" : `${shown.length} of ${all.length} companies with listed bonds`}
        >
          <FilterSelect label="AI analysis" value={params["ai"] ?? ""} options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} onChange={(v) => set("ai", v)} testId="issuers-ai" width="8rem" />
          <FilterSelect label="Scorecard" value={params["sc"] ?? ""} options={SCORECARD_FILTERS} onChange={(v) => set("sc", v)} testId="issuers-sc" width="12rem" />
          <FilterSelect label="State" value={params["state"] ?? ""} options={STATE_FILTERS} onChange={(v) => set("state", v)} testId="issuers-state" width="9rem" />
          <FilterSelect label="Confidence" value={params["conf"] ?? ""} options={CONFIDENCE_FILTERS} onChange={(v) => set("conf", v)} testId="issuers-conf" width="9rem" />
          <FilterSelect label="Industry" value={params["ind"] ?? ""} options={industries} onChange={(v) => set("ind", v)} testId="issuers-ind" width="10rem" />
          <FilterSelect label="Rules" value={params["rule"] ?? ""} options={rules} onChange={(v) => set("rule", v)} testId="issuers-rule" width="10rem" />
          <FilterSelect label="Needs work" value={params["work"] ?? ""} options={[{ value: "any", label: "Anything" }, { value: "you", label: "Yours" }]} onChange={(v) => set("work", v)} testId="issuers-work" width="8rem" />
        </FilterBar>
      </div>

      {narrow ? (
        <ul className="hs-list panel catalyst-list" data-testid="issuers-table">
          {loading && <li className="muted">Loading…</li>}
          {shown.map((r) => (
            <li key={r.c.entityId} data-testid="issuers-row">
              <button type="button" className="cat-row" onClick={() => setParams({ ...params, issuer: r.c.entityId })}>
                <div className="cat-line">
                  <strong>{r.c.shortName}</strong> <span className="muted">{r.c.industry ?? ""}</span>
                </div>
                <div className="cat-line">
                  <IssuerSignalsCell ai={r.c.aiAnalysis.on} signals={r.signals} />
                </div>
                <div className="cat-line muted">
                  {r.bonds.length} bond{r.bonds.length === 1 ? "" : "s"} · owed {mln(r.owed)} m · premium {pp(r.premium)}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <StickyTable
          testId="issuers-table"
          head={
            <tr>
              {th("Company", "name", { left: true })}
              {th("AI", "ai", { left: true, title: "AI analysis: the agent works only on companies switched on" })}
              {th("Industry", "industry", { left: true })}
              {th("Bonds", "bonds", { firstDesc: true, title: "Listed bonds" })}
              {th("Owed (m)", "owed", { firstDesc: true, title: "Owed on Catalyst at the current nominal, PLN bonds" })}
              {th("Due 12 m", "due12", { firstDesc: true, title: "PLN bonds maturing within a year" })}
              {th("Premium", "premium", { firstDesc: true, title: "Median premium of its bonds over the State" })}
              {th("Scorecard", "scorecard", { left: true, firstDesc: true, title: "Debt burden, debt service, liquidity, profitability, asset coverage, refinancing (the rule set in the tooltip)" })}
              {th("Conf.", "confidence", { left: true, firstDesc: true, title: "Data confidence" })}
              {th("Year", "year", { firstDesc: true, title: "The latest full year the scorecard rests on" })}
              {th("Judgement", "judged", { firstDesc: true })}
              {th("Needs work", "work", { firstDesc: true, title: "What catalyst work lists for the company (AI analysis on): the agent's items and yours" })}
            </tr>
          }
        >
          <tbody>
            {loading && <SkeletonRows rows={12} cols={12} />}
            {shown.map((r) => (
              <tr key={r.c.entityId} className="clickable" onClick={() => setParams({ ...params, issuer: r.c.entityId })} data-testid="issuers-row" data-entity={r.c.entityId}>
                <td className="left cat-issuer" title={[r.c.legalName, r.c.krs && `KRS ${r.c.krs}`, r.c.lei && `LEI ${r.c.lei}`].filter(Boolean).join(" · ")}>
                  <strong>{r.c.shortName}</strong>
                </td>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops the row's click; the checkbox has its own keyboard handling */}
                <td className="left" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={r.c.aiAnalysis.on} onChange={(e) => void setAi(r.c, e.target.checked)} aria-label={`AI analysis of ${r.c.shortName}`} data-testid="issuers-ai-switch" />
                </td>
                <td className="left">{r.c.industry ?? <span className="muted">–</span>}</td>
                <td>{r.bonds.length}</td>
                <td title={r.otherCurrencies.length ? `Also bonds in ${r.otherCurrencies.join(", ")}` : ""}>
                  {mln(r.owed)}
                  {r.otherCurrencies.length > 0 && <span className="muted">*</span>}
                </td>
                <td>{mln(r.due12)}</td>
                <td>{pp(r.premium)}</td>
                <td className="left">
                  <IssuerSignalsCell ai={r.c.aiAnalysis.on} signals={r.signals} compact />
                </td>
                <td className={`left${r.signals?.confidence === "low" ? " muted" : ""}`}>{r.signals?.state === "scored" ? (r.signals.confidence ?? "–") : ""}</td>
                <td title={r.signals?.interim ? `FY${r.signals.latestPeriodEnd?.slice(0, 4)} + ${r.signals.interim.label}${r.signals.interim.ttm ? " (TTM)" : ""}, interim unaudited` : ""}>
                  {r.signals?.latestPeriodEnd?.slice(0, 4) ?? "–"}
                  {r.signals?.interim && <span className="muted"> + {r.signals.interim.label.split(" ")[0]}</span>}
                </td>
                <td>{r.c.judgedAt?.slice(0, 10) ?? "–"}</td>
                <td title={r.work.map((w) => `${w.who === "you" ? "You: " : ""}${w.detail}`).join("\n")} data-testid="issuers-work-cell">
                  {r.work.length ? (
                    <>
                      {r.work.length}
                      {r.work.some((w) => w.who === "you") && <span className="neg"> · yours</span>}
                    </>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr>
                <td className="left muted" colSpan={12}>
                  {all.length === 0 ? "No companies yet." : "No companies match the filters."}
                </td>
              </tr>
            )}
          </tbody>
        </StickyTable>
      )}
      <p className="muted catalyst-foot">* Also bonds in other currencies, not in the sum. "Needs work": what <code>catalyst work</code> lists (the agent's items, and yours: a lender's kind, a download).</p>
      </>
      )}

      {params["issuer"] && (
        <IssuerDialog
          entityId={params["issuer"]}
          rows={screen.data?.rows ?? []}
          tab={params["itab"] ?? "bonds"}
          setTab={(t) => setParams({ ...params, itab: t === "bonds" ? undefined : t })}
          onClose={closeDialog}
          onShowBonds={() => {
            window.location.hash = `#/catalyst?co=${encodeURIComponent(params["issuer"]!)}`;
          }}
        />
      )}
    </div>
  );
}
