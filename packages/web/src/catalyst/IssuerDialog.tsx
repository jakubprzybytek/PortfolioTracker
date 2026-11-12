// The issuer dialog (Docs/catalyst.md, "Issuer dialog"): one company's scorecard with its metrics, its bonds falling
// due against cash, the track record and the judgement; tabs for its bonds, years, past bonds, judgements and reports.
// Opened from any issuer name (`issuer=<entityId>` in the URL); full screen on a phone.
import { Icon } from "../Icons.tsx";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { apiSend, api } from "../api.ts";
import { fmtNum } from "../format.ts";
import { MarkdownText } from "../NotesView.tsx";
import { useApi } from "../useApi.ts";
import { TrackTab } from "./BondPanel.tsx";
import { ARROW, ARROW_LABEL, DIMENSIONS, RULE_SETS, SIGNAL_LABEL } from "./issuer.tsx";
import { pct, pp, webHref } from "./labels.ts";
import { LiquidityDots } from "./parts.tsx";
import { lineShapes } from "./statementTree.ts";
import type { AiSwitch, BondRow, CompanyDetail, CompanyYear, Dimension, Metric, ReviewStatus, YearLines } from "./types.ts";

const TABS = [
  ["bonds", "Bonds"],
  ["financials", "Financials"],
  ["track", "Track record"],
  ["judgements", "Judgements"],
  ["documents", "Documents"],
] as const;

/** Millions, one decimal: "1 234,5". */
const mln = (v: number | null | undefined) => (v === null || v === undefined ? "–" : fmtNum(v / 1e6, 1));
const FORMAT: Record<string, string> = { "krs-xml": "KRS e-report (XML)", esef: "ESEF", pdf: "PDF", "ifrs-text": "IFRS text" };
const formatLabel = (f: string) => FORMAT[f] ?? f;
/** An interim period's name: "H1 2026", "Q1 2026", "Q1–Q3 2026" (as core/catalyst/issuers/interim.ts). */
/** A stored period's name: "FY2025", or "H1 2026" for a half-year. */
const yearLabel = (y: { periodEnd: string; months: number }) => (y.months < 12 ? periodLabel(y.periodEnd, y.months) : `FY${y.periodEnd.slice(0, 4)}`);

const periodLabel = (periodEnd: string, months: number) => {
  const year = periodEnd.slice(0, 4);
  return months === 6 ? `H1 ${year}` : months === 3 ? `Q1 ${year}` : months === 9 ? `Q1–Q3 ${year}` : `${months} m to ${periodEnd}`;
};

/** `onOpenBond`: a bond's code in the Bonds tab opens its panel. */
export function IssuerDialog({ entityId, rows, tab, setTab, onClose, onShowBonds, onOpenBond, viewToggle }: { entityId: string; rows: BondRow[]; tab: string; setTab: (t: string) => void; onClose: () => void; onShowBonds: () => void; onOpenBond: (isin: string) => void; viewToggle?: { label: string; on: boolean; title: string; toggle: () => void } }) {
  const detail = useApi<CompanyDetail>(`/catalyst/entities/${encodeURIComponent(entityId)}`);
  const d = detail.data;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAi = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ aiAnalysis: AiSwitch }>("PUT", `/catalyst/entities/${encodeURIComponent(entityId)}/ai`, { on });
      detail.update((x) => (x ? { ...x, company: { ...x.company, aiAnalysis: res.aiAnalysis } } : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const c = d?.company;
  const a = d?.analysis;
  const ai = c?.aiAnalysis.on ?? false;
  const own = rows.filter((r) => r.entityId === entityId);
  const latest = d?.analyses[0];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click outside the dialog closes it; Escape does the same from the keyboard
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="modal cat-issuer-dialog" role="dialog" aria-modal="true" aria-label={c?.shortName ?? "Issuer"} data-testid="issuer-dialog">
        <header className="modal-header cat-issuer-head">
          <div>
            <h2 data-testid="issuer-name">{c?.shortName ?? (detail.loading ? "Loading…" : entityId)}</h2>
            {c && (
              <p className="muted cat-facts">
                {[c.legalName, c.country, c.krs && `KRS ${c.krs}`, c.lei && `LEI ${c.lei}`, c.industry].filter(Boolean).join(" · ")}
                {a && ` · ${RULE_SETS[a.ruleSet] ?? a.ruleSet} rules`}
                {a?.scorecard?.confidence && ` · ${a.scorecard.confidence.level} confidence`}
              </p>
            )}
          </div>
          <div className="cat-issuer-actions">
            {viewToggle && (
              <button type="button" className={`cat-toggle${viewToggle.on ? " on" : ""}`} onClick={viewToggle.toggle} title={viewToggle.title} aria-pressed={viewToggle.on} data-testid="issuer-view-toggle">
                <Icon name={viewToggle.label.startsWith("Hide") ? "eye-off" : viewToggle.on ? "check" : "plus"} size={15} /> {viewToggle.label}
              </button>
            )}
            {c && (
              <button
                type="button"
                role="switch"
                aria-checked={ai}
                className={`cat-toggle${ai ? " on" : ""}`}
                disabled={busy}
                onClick={() => void setAi(!ai)}
                title={`The agent keeps this company's scorecard current (saved at once). ${c.aiAnalysis.at ? `${ai ? "On" : "Off"} since ${c.aiAnalysis.at.slice(0, 10)}${c.aiAnalysis.by ? ` (${c.aiAnalysis.by})` : ""}` : "Off: the agent doesn't work on this company"}`}
                data-testid="issuer-ai-switch"
              >
                <span className="cat-toggle-dot" aria-hidden="true" /> AI analysis
              </button>
            )}
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close" data-testid="issuer-close">
              ✕
            </button>
          </div>
        </header>
        {detail.error && <p className="error">{detail.error}</p>}
        {error && <p className="error">{error}</p>}
        {d && a && (
          <>
            <p className="muted cat-facts" data-testid="issuer-source">
              {a.source ? `${formatLabel(a.source.format)}, ${a.source.scope} accounts, FY${a.source.latestPeriodEnd.slice(0, 4)}${a.source.years > 1 ? ` and ${a.source.years - 1} earlier` : ""}` : "No full year stored"}
              {a.source?.interim && (
                <span data-testid="issuer-source-interim">
                  {" "}
                  + {a.source.interim.label} ({a.source.interim.ttm.length ? `TTM to ${a.source.interim.periodEnd}` : `balance sheet at ${a.source.interim.periodEnd}`}, unaudited)
                </span>
              )}
              {a.source?.interimSkipped && <span className="muted"> · {a.source.interimSkipped}</span>}
              {latest && ` · judgement ${latest.at.slice(0, 10)}`}
            </p>
            {c?.businessSummary && (
              <details className="cat-summary-line">
                <summary className="muted">What the company does</summary>
                {c.businessSummary}
                {c.website && webHref(c.website) && (
                  <>
                    {" "}
                    <a href={webHref(c.website)} target="_blank" rel="noopener noreferrer">
                      {c.website.replace(/^https?:\/\//, "")}
                    </a>
                  </>
                )}
              </details>
            )}
            {!ai && (
              <p className="cat-ai-off-note" data-testid="issuer-ai-off-callout">
                {a.scorecard ? `AI analysis off${c?.aiAnalysis.at ? ` since ${c.aiAnalysis.at.slice(0, 10)}` : ""}: the scorecard isn't kept current.` : "AI analysis off: the agent doesn't work on this company, so it has no scorecard."}{" "}
                <button type="button" className="link-button" disabled={busy} onClick={() => void setAi(true)} data-testid="issuer-ai-enable">
                  Enable
                </button>
              </p>
            )}
            <div className="cat-issuer-top">
              <section className="cat-panel">
                <h3 className="cat-panel-title">Scorecard</h3>
                <Scorecard d={d} />
              </section>
              <section className="cat-panel cat-issuer-side">
                <Due d={d} />
                <p className="cat-facts cat-track-line" data-testid="issuer-track-line">
                  Track record since {d.track.since?.slice(0, 7) ?? "–"}: {d.track.counts.repaid} repaid, {d.track.counts.early} early, {d.track.counts["below-par"]} below par
                  {d.track.flags.length ? <span className="neg"> · {d.track.flags.length} red flag{d.track.flags.length === 1 ? "" : "s"}</span> : " · no red flags"}
                </p>
              </section>
            </div>
            {latest && judgementLine(latest.markdown) && (
              <p className="cat-facts cat-judgement-line" data-testid="issuer-judgement">
                <strong>Judgement:</strong> {judgementLine(latest.markdown)}
              </p>
            )}
          </>
        )}
        {!d && detail.loading && <SummarySkeleton />}
        <div className="cat-tabs-scroll">
        <div className="segmented cat-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "active" : ""} onClick={() => setTab(k)} data-testid={`issuer-tab-${k}`}>
              {label}
              {k === "bonds" && own.length ? ` (${own.length})` : ""}
            </button>
          ))}
        </div>
        </div>
        <div className="cat-issuer-tab">
          {tab === "bonds" && <BondsTab rows={own} onShowBonds={onShowBonds} onOpenBond={onOpenBond} />}
          {tab === "financials" && d && <FinancialsTab d={d} onReviewed={detail.reload} />}
          {tab === "track" && <TrackTab detail={d ? { track: d.track, events: [] } : undefined} loading={detail.loading} />}
          {tab === "judgements" && d && <JudgementsTab d={d} />}
          {tab === "documents" && d && <DocumentsTab d={d} />}
        </div>
      </section>
    </div>
  );
}

/**
 * The judgement in short: its "Judgement:" paragraph (the §14 layout), else the first paragraph of prose, without
 * Markdown's marks. Paragraphs of metadata ("Date: … Model: …", "Notes: …") and code don't count: a judgement
 * imported from CatalystViewer has only those, and then there is no line.
 */
const judgementLine = (md: string) => {
  const paragraphs = md
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s.*$/gm, "").replace(/[*_`]/g, "").trim())
    .filter((p) => p && !p.startsWith("|") && !p.startsWith("-"));
  const judgement = paragraphs.find((p) => /^Judgement:/i.test(p));
  if (judgement) return judgement.replace(/^Judgement:\s*/i, "");
  return paragraphs.find((p) => !/^[A-Z][\w ]{0,20}:/.test(p)) ?? "";
};

function Scorecard({ d }: { d: CompanyDetail }) {
  const a = d.analysis;
  if (a.state === "out-of-scope") return <p className="muted">Not scored: {d.company.industry ?? "this kind of company"} is outside the scorecard (banks, insurers, the State, municipalities, a lender of no known kind).</p>;
  if (!a.scorecard) return <p className="muted">No report yet: the scorecard needs a full year.</p>;
  return (
    <ul className="cat-scorecard" data-testid="issuer-scorecard">
      {DIMENSIONS.map((dim) => {
        const x = a.scorecard!.dimensions.find((y) => y.name === dim.name);
        return x ? <DimensionRow key={dim.name} label={dim.label} x={x} /> : null;
      })}
    </ul>
  );
}

function DimensionRow({ label, x }: { label: string; x: Dimension }) {
  const scored = x.metrics.filter((m) => m.scored !== false);
  const shown = x.metrics.filter((m) => m.scored === false);
  const trend = x.trend?.metrics ?? [];
  return (
    <li data-testid="issuer-dimension">
      <details>
        <summary>
          <span className={`cat-dot ${x.signal}`} title={SIGNAL_LABEL[x.signal]} /> <strong>{label}</strong>
          {x.trend && (
            <span className={`cat-arrow ${x.trend.arrow}`} title={`Trend: ${ARROW_LABEL[x.trend.arrow]}`}>
              {" "}
              {ARROW[x.trend.arrow]}
            </span>
          )}{" "}
          <span className="muted cat-dim-values">{scored.map((m) => `${m.name} ${m.formattedValue}`).join(" · ")}</span>
        </summary>
        <ul className="cat-metrics">
          {[...scored, ...shown].map((m) => (
            <MetricRow key={m.name} m={m} />
          ))}
          {trend.length > 0 && <li className="cat-metrics-sub">Trend over the years</li>}
          {trend.map((m) => (
            <MetricRow key={`trend-${m.name}`} m={m} />
          ))}
        </ul>
        {x.notes && x.notes.length > 0 && (
          <ul className="cat-dim-notes">
            {x.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </details>
    </li>
  );
}

/** A metric: its dot, name and value, and where the value sits against its thresholds. */
function MetricRow({ m }: { m: Metric }) {
  return (
    <li className="cat-metric">
      <span className="cat-metric-name">
        <span className={`cat-dot small ${m.signal}`} /> {m.name}
        {m.scored === false && <span className="muted"> · for context</span>}
      </span>
      <span className="cat-metric-value">{m.formattedValue}</span>
      {m.bands ? <Gauge m={m} bands={m.bands} /> : <span />}
    </li>
  );
}

type Bands = NonNullable<Metric["bands"]>;
const bandValue = (v: number, unit: Bands["unit"]) =>
  unit === "%" ? `${+(v * 100).toFixed(Math.abs(v) < 0.01 && v !== 0 ? 2 : 1)}%` : unit === "slope" ? `${+v.toFixed(3)}` : `${+v.toFixed(2)}×`;

/**
 * Red, yellow and green zones of equal width, worse to better from left to right (whichever way the ratio is good),
 * the two thresholds under their borders and a mark at the value. Beyond the yellow zone the scale runs on at the
 * same rate for one more width of it, so the mark's distance from a border says how far the value is from it.
 */
function Gauge({ m, bands }: { m: Metric; bands: Bands }) {
  const { better, green, yellow, unit } = bands;
  const width = Math.abs(green - yellow) || 1;
  const t = m.value === null ? null : (better === "higher" ? m.value - yellow : yellow - m.value) / width;
  const at = t === null ? null : Math.min(1, Math.max(0, (1 + t) / 3));
  const g = bandValue(green, unit);
  const y = bandValue(yellow, unit);
  const title = better === "higher" ? `Green above ${g}, yellow ${y} to ${g}, red below ${y}` : `Green below ${g}, yellow ${g} to ${y}, red above ${y}`;
  return (
    <span className="cat-gauge" title={title} role="img" aria-label={`${m.name} ${m.formattedValue}. ${title}`}>
      <span className="cat-gauge-track">
        <span className="red" />
        <span className="yellow" />
        <span className="green" />
        {at !== null && <span className={`cat-gauge-mark${at === 0 ? " off-left" : at === 1 ? " off-right" : ""}`} style={{ left: `${at * 100}%` }} />}
      </span>
      <span className="cat-gauge-ticks">
        <span style={{ left: "33.333%" }}>{y}</span>
        <span style={{ left: "66.667%" }}>{g}</span>
      </span>
    </span>
  );
}

/** Bonds falling due within 12 and 24 months against cash, by year of maturity. */
function Due({ d }: { d: CompanyDetail }) {
  const r = d.analysis.refinancing;
  if (!r || r.bonds.length === 0) return <p className="muted cat-facts">No listed bonds outstanding.</p>;
  const byYear = new Map<string, number>();
  // Instalments in their own years when the schedule is known, else the whole amount at maturity.
  for (const b of r.bonds)
    for (const p of b.payments ?? [{ date: b.maturityDay, amount: b.amount, inReportCurrency: b.inReportCurrency }])
      byYear.set(p.date.slice(0, 4), (byYear.get(p.date.slice(0, 4)) ?? 0) + (p.inReportCurrency ?? p.amount));
  const years = [...byYear].sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(...byYear.values(), r.report?.cash ?? 0);
  const cur = r.report?.currency ?? "PLN";
  const bar = (v: number) => ({ width: `${max > 0 ? (v / max) * 100 : 0}%` });
  return (
    <div className="cat-due" data-testid="issuer-due">
      <h3 className="cat-panel-title">
        Bonds falling due <span className="cat-panel-unit">m {cur}, by year of repayment, against cash</span>
      </h3>
      <div className="cat-due-bars">
        {years.map(([year, v]) => (
          <div key={year} className="cat-due-row" title={`Bonds repaid in ${year} (instalments included): ${mln(v)} m ${cur}`}>
            <span className="cat-due-label">{year}</span>
            <span className="cat-due-track">
              <span className="bar" style={bar(v)} />
            </span>
            <span className="cat-due-value">{mln(v)}</span>
          </div>
        ))}
        {r.report?.cash !== undefined && (
          <div className="cat-due-row cash" title={`Cash at ${r.report.periodEnd}: ${mln(r.report.cash)} m ${cur}`}>
            <span className="cat-due-label">Cash</span>
            <span className="cat-due-track">
              <span className="bar cash" style={bar(r.report.cash)} />
            </span>
            <span className="cat-due-value">{mln(r.report.cash)}</span>
          </div>
        )}
      </div>
      <p className="cat-facts muted">
        Due in 12 months {mln(r.report?.due12)}, in 24 months {mln(r.report?.due24)}
        {r.report?.cashCover12 !== undefined && `; cash covers ${fmtNum(r.report.cashCover12, 1)}× the next 12 months`}
        {r.report?.periodEnd && ` (cash at ${r.report.periodEnd})`}
      </p>
    </div>
  );
}

function BondsTab({ rows, onShowBonds, onOpenBond }: { rows: BondRow[]; onShowBonds: () => void; onOpenBond: (isin: string) => void }) {
  if (rows.length === 0) return <p className="muted">No listed bonds.</p>;
  return (
    <div className="cat-track">
      <div className="table-wrap">
        <table className="static" data-testid="issuer-bonds">
          <thead>
            <tr>
              <th className="left">Bond</th>
              <th className="left">Maturity</th>
              <th>Owed (m)</th>
              <th>Yield net</th>
              <th>Premium</th>
              <th>Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => (a.maturity ?? "").localeCompare(b.maturity ?? ""))
              .map((r) => (
                <tr key={r.isin}>
                  <td className="left">
                    <button type="button" className="link-button cat-name" onClick={() => onOpenBond(r.isin)} title="Open the bond: price, yield, coupons, track record" data-testid="issuer-bond">
                      <strong>{r.code}</strong>
                    </button>
                  </td>
                  <td className="left">{r.maturity ?? "–"}</td>
                  <td>{r.issueAmount ? `${mln(r.issueAmount)}${r.currency !== "PLN" ? ` ${r.currency}` : ""}` : "–"}</td>
                  <td>{pct(r.yieldNet)}</td>
                  <td>{pp(r.premium)}</td>
                  <td>
                    <LiquidityDots level={r.liquidity.level} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p>
        <button type="button" className="link-button" onClick={onShowBonds} data-testid="issuer-show-bonds">
          Show in the bonds table
        </button>
      </p>
    </div>
  );
}

/**
 * The figures the scorecard reads, by statement; the level is how far a figure is part of the one above it (current
 * assets are part of total assets, cash part of current assets, bonds part of financial debt). Minority interests stay
 * beside equity: under the accounting act they're outside it.
 */
const SECTIONS: { title: string; figures: [key: string, label: string, level: number][] }[] = [
  {
    title: "Balance sheet",
    figures: [
      ["totalAssets", "Total assets", 0],
      ["intangibleAssets", "Intangible assets", 1],
      ["currentAssets", "Current assets", 1],
      ["inventory", "Inventory", 2],
      ["cash", "Cash", 2],
      ["equity", "Equity", 0],
      ["minorityInterests", "Minority interests", 0],
      ["financialDebt", "Financial debt", 0],
      ["bonds", "Bonds", 1],
      ["currentLiabilities", "Current liabilities", 0],
    ],
  },
  {
    title: "Income statement",
    figures: [
      ["revenue", "Revenue", 0],
      ["ebit", "EBIT", 0],
      ["depreciation", "Depreciation", 1],
      ["interestExpense", "Interest expense", 0],
      ["netProfit", "Net profit", 0],
    ],
  },
  {
    title: "Cash flow",
    figures: [
      ["operatingCashFlow", "Operating cash flow", 0],
      ["capex", "Capex", 0],
    ],
  },
];
const FIGURES = SECTIONS.flatMap((s) => s.figures);
const REVIEW: Record<ReviewStatus, string> = { parsed: "parsed", "hand-checked": "hand-checked", flagged: "flagged" };

function FinancialsTab({ d, onReviewed }: { d: CompanyDetail; onReviewed: () => void }) {
  // Up to six columns, newest first: the interim periods (H1 2026, H1 2025) beside the full years.
  const years = [...d.years].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.scope.localeCompare(b.scope)).slice(0, 7);
  const [open, setOpen] = useState<{ period: string; field?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const review = async (y: CompanyYear, status: ReviewStatus) => {
    setBusy(y.period);
    setError(null);
    try {
      await apiSend("PUT", `/catalyst/entities/${encodeURIComponent(d.company.entityId)}/years/${encodeURIComponent(y.period)}`, { status });
      onReviewed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  if (years.length === 0) return <p className="muted">{d.company.financialsEntityId ? `Read on the reports of its group (${d.company.financialsEntityId}).` : "No years stored."}</p>;
  const sections = SECTIONS.map((s) => ({ ...s, figures: s.figures.filter(([k]) => years.some((y) => y.figures[k])) })).filter((s) => s.figures.length > 0);
  return (
    <div className="cat-track">
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="static cat-years" data-testid="issuer-years">
          <thead>
            <tr>
              <th className="left">m {years[0]!.currency}</th>
              {years.map((y) => (
                <th key={y.period} title={`${y.periodStart} – ${y.periodEnd}, ${y.months} months; from the ${y.reportPeriodEnd.slice(0, 4)} report (${y.column === "current" ? "its year" : "its comparative"}); ${formatLabel(y.filing.format)}; imported by ${y.enteredBy}`}>
                  {yearLabel(y)}
                  <br />
                  <span className="muted">{y.scope}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.flatMap((s) => [
              <tr key={s.title} className="cat-section-row">
                <th className="left" colSpan={years.length + 1} scope="colgroup">
                  {s.title}
                </th>
              </tr>,
              ...s.figures.map(([k, label, level]) => (
              <tr key={k} className={level === 0 ? "cat-top" : undefined}>
                <td className="left cat-indent" style={{ "--depth": level } as CSSProperties}>{label}</td>
                {years.map((y) => {
                  const f = y.figures[k];
                  return (
                    <td key={y.period}>
                      {f ? (
                        <button type="button" className="link-button" title="The lines behind this figure" onClick={() => setOpen({ period: y.period, field: k })}>
                          {mln(f.value)}
                        </button>
                      ) : (
                        "–"
                      )}
                    </td>
                  );
                })}
              </tr>
              )),
            ])}
            <tr className="cat-review-row">
              <td className="left">Review</td>
              {years.map((y) => (
                <td key={y.period} data-testid="issuer-year-review" data-period={y.period}>
                  <div className="cat-review">
                    <span className={`flag cat-review-${y.review.status}`} title={y.review.note ?? (y.review.at ? `${y.review.at.slice(0, 10)} ${y.review.by ?? ""}` : "Read by code, not checked against the printed report yet")}>
                      {REVIEW[y.review.status]}
                    </span>
                    <span className="cat-review-actions">
                      {y.review.status !== "hand-checked" && (
                        <button type="button" className="cat-mini" disabled={busy === y.period} onClick={() => void review(y, "hand-checked")} title="Mark as hand-checked: the figures match the printed report" aria-label={`Mark ${yearLabel(y)} hand-checked`} data-testid="issuer-year-check">
                          <Icon name="check" size={13} />
                          Check
                        </button>
                      )}
                      {y.review.status !== "flagged" && (
                        <button type="button" className="cat-mini" disabled={busy === y.period} onClick={() => void review(y, "flagged")} title="Flag: something's wrong in this year" aria-label={`Flag ${yearLabel(y)}`} data-testid="issuer-year-flag">
                          <Icon name="flag" size={13} />
                          Flag
                        </button>
                      )}
                      {y.review.status !== "parsed" && (
                        <button type="button" className="cat-mini" disabled={busy === y.period} onClick={() => void review(y, "parsed")} title="Back to parsed" aria-label={`Undo the review of ${yearLabel(y)}`}>
                          <Icon name="undo" size={13} />
                          Undo
                        </button>
                      )}
                    </span>
                  </div>
                </td>
              ))}
            </tr>
            <tr className="cat-statements-row">
              <td className="left">Statements</td>
              {years.map((y) => (
                <td key={y.period}>
                  <button
                    type="button"
                    className={`cat-mini${open?.period === y.period && !open.field ? " on" : ""}`}
                    aria-expanded={open?.period === y.period && !open.field}
                    onClick={() => setOpen(open?.period === y.period && !open.field ? null : { period: y.period })}
                    title={`The ${yearLabel(y)} statements as printed: balance sheet, income statement, cash flow`}
                    data-testid="issuer-year-lines"
                  >
                    <Icon name="notes" size={13} />
                    {y.lines} lines
                    <Icon name="chevron-down" size={13} className="cat-mini-caret" />
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {open && <YearLinesView entityId={d.company.entityId} period={open.period} months={years.find((y) => y.period === open.period)?.months} field={open.field} onClose={() => setOpen(null)} />}
      {d.collected.length > 0 && <p className="muted cat-facts">Figures collected from the web (no report available): {d.collected.length} set{d.collected.length === 1 ? "" : "s"}, the latest {d.collected[0]!.at.slice(0, 10)}.</p>}
    </div>
  );
}

const STATEMENT: Record<string, string> = { balance: "Balance sheet", income: "Income statement", cashFlow: "Cash flow statement" };

/** A year's lines as printed: all of them, or the ones behind one figure. */
function YearLinesView({ entityId, period, months, field, onClose }: { entityId: string; period: string; months?: number; field: string | undefined; onClose: () => void }) {
  const y = useApi<YearLines>(`/catalyst/entities/${encodeURIComponent(entityId)}/years/${encodeURIComponent(period)}`);
  const [showEmpty, setShowEmpty] = useState(false);
  const shapes = useMemo(() => lineShapes(y.data?.lines ?? []), [y.data]);
  if (!y.data) return <p className="muted">{y.error ?? "Loading…"}</p>;
  const source = field ? (y.data.figures[field]?.source ?? []) : [];
  const behind = (l: { code?: string; label: string }) => source.some((s) => (l.code && (s === l.code || s.endsWith(`/${l.code}`))) || s === l.label || s.endsWith(`/${l.label}`));
  const shapeOf = (l: { statement: string; order: number }) => shapes.get(`${l.statement}#${l.order}`);
  const all = field ? y.data.lines.filter(behind) : y.data.lines;
  // The whole statements hide empty lines (zero, nothing under them: most of the KRS template) unless asked.
  const emptyCount = field ? 0 : all.filter((l) => shapeOf(l)?.empty).length;
  const lines = field || showEmpty ? all : all.filter((l) => !shapeOf(l)?.empty);
  const label = field ? FIGURES.find(([k]) => k === field)?.[1] : undefined;
  const name = months ? yearLabel({ periodEnd: period.slice(0, 10), months }) : `FY${period.slice(0, 4)}`;
  return (
    <section className="cat-lines" data-testid="issuer-lines">
      <p className="cat-facts">
        <strong>{label ? `${label}, ${name}` : `${name}, ${period.split("#")[1]} accounts: the statements`}</strong> (m {y.data.currency}){" "}
        {emptyCount > 0 && (
          <>
            <button type="button" className="link-button" onClick={() => setShowEmpty(!showEmpty)} data-testid="issuer-lines-empty">
              {showEmpty ? "hide" : "show"} {emptyCount} empty line{emptyCount === 1 ? "" : "s"}
            </button>{" "}
            ·{" "}
          </>
        )}
        <button type="button" className="link-button" onClick={onClose}>
          close
        </button>
      </p>
      {field && lines.length === 0 && <p className="muted cat-facts">From: {source.join(", ") || "–"}</p>}
      {Object.entries(STATEMENT).map(([k, title]) => {
        const these = lines.filter((l) => l.statement === k);
        if (these.length === 0) return null;
        return (
          <details key={k} open={!!field || k === "balance"}>
            <summary>{title}</summary>
            <table className="static">
              <tbody>
                {these.map((l) => {
                  const shape = shapeOf(l);
                  // Only lines behind one figure: no indentation (their parents may not be shown).
                  const depth = field ? 0 : (shape?.depth ?? 0);
                  return (
                  <tr key={`${l.order}`} className={`${l.item ? "" : "muted"}${shape?.subtotal ? " cat-subtotal" : ""}`} data-depth={depth}>
                    <td className="left cat-indent" style={{ "--depth": depth } as CSSProperties}>
                      {l.label}
                      {l.page ? <span className="muted"> · p. {l.page}</span> : null}
                    </td>
                    <td>{mln(l.value)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        );
      })}
    </section>
  );
}

function JudgementsTab({ d }: { d: CompanyDetail }) {
  if (d.analyses.length === 0) return <p className="muted">No judgement yet{d.company.aiAnalysis.on ? ": the agent writes one after reading the reports." : " (AI analysis off)."}</p>;
  const [latest, ...earlier] = d.analyses;
  return (
    <div className="cat-track" data-testid="issuer-judgements">
      <p className="muted cat-facts">
        {latest!.at.slice(0, 10)} · {latest!.by}
        {latest!.source === "CatalystViewer" ? " (from CatalystViewer)" : ""}
        {latest!.provisional && <span className="neg"> · provisional</span>}
      </p>
      {latest!.provisional && (
        <ul className="cat-facts neg" data-testid="issuer-judgement-provisional">
          {latest!.provisional.map((g) => (
            <li key={g}>Missed: {g}</li>
          ))}
        </ul>
      )}
      <MarkdownText text={latest!.markdown} />
      {earlier.map((j) => (
        <details key={j.at}>
          <summary>
            {j.at.slice(0, 10)} · {j.by}
            {j.provisional ? " · provisional" : ""}
          </summary>
          <MarkdownText text={j.markdown} />
        </details>
      ))}
    </div>
  );
}

function DocumentsTab({ d }: { d: CompanyDetail }) {
  const [error, setError] = useState<string | null>(null);
  const open = async (sha: string, what: "filings" | "documents" = "filings") => {
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/catalyst/entities/${encodeURIComponent(d.company.entityId)}/${what}/${sha}`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const docs = d.documents ?? [];
  if (d.filings.length === 0 && docs.length === 0) return <p className="muted">No reports imported, no documents stored.</p>;
  return (
    <div className="cat-track">
      {error && <p className="error">{error}</p>}
      <h4 className="cat-subhead">Statements imported</h4>
      {d.filings.length === 0 && <p className="muted">None.</p>}
      <div className="table-wrap">
        <table className="static" data-testid="issuer-documents">
          <thead>
            <tr>
              <th className="left">Report</th>
              <th className="left">Year end</th>
              <th className="left">Format</th>
              <th className="left">Years stored</th>
              <th className="left">Imported</th>
            </tr>
          </thead>
          <tbody>
            {[...d.filings]
              .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
              .map((f) => (
                <tr key={f.sha256}>
                  <td className="left">
                    <button type="button" className="link-button" onClick={() => void open(f.sha256)} title="Open the original">
                      {f.fileName}
                    </button>
                  </td>
                  <td className="left">
                    {f.periodEnd} · {f.scope}
                  </td>
                  <td className="left">{formatLabel(f.format)}</td>
                  <td className="left" title={[f.kept.length ? `kept from a newer report: ${f.kept.join(", ")}` : "", f.replaced.length ? `replaced: ${f.replaced.join(", ")}` : ""].filter(Boolean).join("; ")}>
                    {f.stored.map((p) => p.slice(0, 4)).join(", ") || "–"}
                    {f.checks.length > 0 && <span className="neg" title={f.checks.join("\n")}> · {f.checks.length} check{f.checks.length === 1 ? "" : "s"}</span>}
                  </td>
                  <td className="left muted">
                    {f.importedAt.slice(0, 10)} · {f.enteredBy}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <h4 className="cat-subhead">Other documents</h4>
      {docs.length === 0 ? (
        <p className="muted">None stored (the auditor's report, the management report, interim and current reports the judgement read).</p>
      ) : (
        <div className="table-wrap">
          <table className="static" data-testid="issuer-other-documents">
            <thead>
              <tr>
                <th className="left">Document</th>
                <th className="left">Kind</th>
                <th className="left">Date</th>
                <th className="left">Stored</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((x) => (
                <tr key={x.sha256}>
                  <td className="left">
                    <button type="button" className="link-button" onClick={() => void open(x.sha256, "documents")} title={`Open ${x.fileName}`}>
                      {x.title}
                    </button>
                    {webHref(x.sourceUrl) && (
                      <a className="muted" href={webHref(x.sourceUrl)} target="_blank" rel="noopener noreferrer" title="Where it came from">
                        {" "}
                        ↗
                      </a>
                    )}
                  </td>
                  <td className="left">{DOC_KIND[x.kind] ?? x.kind}</td>
                  <td className="left">{x.date}</td>
                  <td className="left muted">
                    {x.at.slice(0, 10)} · {x.by}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const DOC_KIND: Record<string, string> = { audit: "auditor's report", management: "management report", interim: "interim report", annual: "annual report", "current-report": "current report", terms: "bond terms", other: "other" };

/** The scorecard, bonds due and judgement while the company loads: their shape, pulsing. */
function SummarySkeleton() {
  return (
    <div className="cat-issuer-loading" role="status" aria-busy="true" aria-label="Loading the company" data-testid="issuer-loading">
      <span className="skeleton-bar" style={{ width: "55%" }} />
      <div className="cat-issuer-top">
        <div className="cat-issuer-side">
          {[70, 62, 58, 66, 52, 80].map((w) => (
            <span key={w} className="skeleton-bar" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="cat-issuer-side">
          {[75, 40, 60, 85, 50].map((w) => (
            <span key={w} className="skeleton-bar" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <span className="skeleton-bar" style={{ width: "95%" }} />
      <span className="skeleton-bar" style={{ width: "88%" }} />
    </div>
  );
}
