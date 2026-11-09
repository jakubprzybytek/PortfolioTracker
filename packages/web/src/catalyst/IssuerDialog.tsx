// The issuer dialog (Docs/catalyst.md, "Issuer dialog"): one company's scorecard with its metrics, its bonds falling
// due against cash, the track record and the judgement; tabs for its bonds, years, past bonds, judgements and reports.
// Opened from any issuer name (`issuer=<entityId>` in the URL); full screen on a phone.
import { Icon } from "../Icons.tsx";
import { useEffect, useState } from "react";
import { apiSend, api } from "../api.ts";
import { fmtNum } from "../format.ts";
import { MarkdownText } from "../NotesView.tsx";
import { useApi } from "../useApi.ts";
import { TrackTab } from "./BondPanel.tsx";
import { ARROW, ARROW_LABEL, DIMENSIONS, RULE_SETS, SIGNAL_LABEL } from "./issuer.tsx";
import { pct, pp } from "./labels.ts";
import { LiquidityDots } from "./parts.tsx";
import type { AiSwitch, BondRow, CompanyDetail, CompanyYear, Dimension, ReviewStatus, YearLines } from "./types.ts";

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
const periodLabel = (periodEnd: string, months: number) => {
  const year = periodEnd.slice(0, 4);
  return months === 6 ? `H1 ${year}` : months === 3 ? `Q1 ${year}` : months === 9 ? `Q1–Q3 ${year}` : `${months} m to ${periodEnd}`;
};

export function IssuerDialog({ entityId, rows, tab, setTab, onClose, onShowBonds, viewToggle }: { entityId: string; rows: BondRow[]; tab: string; setTab: (t: string) => void; onClose: () => void; onShowBonds: () => void; viewToggle?: { label: string; on: boolean; title: string; toggle: () => void } }) {
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
                {c.website && (
                  <>
                    {" "}
                    <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noopener noreferrer">
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
              <Scorecard d={d} />
              <div className="cat-issuer-side">
                <Due d={d} />
                <p className="cat-facts" data-testid="issuer-track-line">
                  Track record since {d.track.since?.slice(0, 7) ?? "–"}: {d.track.counts.repaid} repaid, {d.track.counts.early} early, {d.track.counts["below-par"]} below par
                  {d.track.flags.length ? <span className="neg"> · {d.track.flags.length} red flag{d.track.flags.length === 1 ? "" : "s"}</span> : " · no red flags"}
                </p>
              </div>
            </div>
            {latest && (
              <p className="cat-facts cat-judgement-line" data-testid="issuer-judgement">
                <strong>Judgement:</strong> {firstParagraph(latest.markdown)}
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
          {tab === "bonds" && <BondsTab rows={own} onShowBonds={onShowBonds} />}
          {tab === "financials" && d && <FinancialsTab d={d} onReviewed={detail.reload} />}
          {tab === "track" && <TrackTab detail={d ? { track: d.track, events: [] } : undefined} loading={detail.loading} />}
          {tab === "judgements" && d && <JudgementsTab d={d} />}
          {tab === "documents" && d && <DocumentsTab d={d} />}
        </div>
      </section>
    </div>
  );
}

/** The judgement in short: its "Judgement:" paragraph (the §14 layout), else the first one, without Markdown's marks. */
const firstParagraph = (md: string) => {
  const paragraphs = md
    .split(/\n\s*\n/)
    .map((p) => p.replace(/^#+\s.*$/gm, "").replace(/[*_`]/g, "").trim())
    .filter((p) => p && !p.startsWith("|"));
  const judgement = paragraphs.find((p) => /^Judgement:/i.test(p));
  return judgement ? judgement.replace(/^Judgement:\s*/i, "") : (paragraphs[0] ?? "");
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
          <span className="muted">{scored.map((m) => `${m.name} ${m.formattedValue}`).join(" · ")}</span>
        </summary>
        <ul className="cat-metrics">
          {[...scored, ...shown, ...(x.trend?.metrics ?? [])].map((m) => (
            <li key={m.name}>
              <span className={`cat-dot small ${m.signal}`} /> {m.name}: {m.formattedValue}
              {m.scored === false && <span className="muted"> (for context)</span>}
            </li>
          ))}
          {x.notes?.map((n) => (
            <li key={n} className="muted">
              {n}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

/** Bonds falling due within 12 and 24 months against cash, by year of maturity. */
function Due({ d }: { d: CompanyDetail }) {
  const r = d.analysis.refinancing;
  if (!r || r.bonds.length === 0) return <p className="muted cat-facts">No listed bonds outstanding.</p>;
  const byYear = new Map<string, number>();
  for (const b of r.bonds) byYear.set(b.maturityDay.slice(0, 4), (byYear.get(b.maturityDay.slice(0, 4)) ?? 0) + (b.inReportCurrency ?? b.amount));
  const max = Math.max(...byYear.values(), r.report?.cash ?? 0);
  const cur = r.report?.currency ?? "PLN";
  return (
    <div className="cat-due" data-testid="issuer-due">
      <p className="cat-facts">
        <strong>Bonds falling due</strong> (m {cur}): 12 months {mln(r.report?.due12)} · 24 months {mln(r.report?.due24)} · cash {mln(r.report?.cash)}
        {r.report?.cashCover12 !== undefined && ` · cash covers ${fmtNum(r.report.cashCover12, 1)}× the next 12 months`}
      </p>
      <div className="cat-due-bars">
        {[...byYear].map(([year, v]) => (
          <div key={year} title={`${year}: ${mln(v)} m ${cur}`}>
            <span className="bar" style={{ width: `${(v / max) * 100}%` }} />
            <span className="muted">
              {year} {mln(v)}
            </span>
          </div>
        ))}
        {r.report?.cash !== undefined && (
          <div title={`Cash at ${r.report.periodEnd}`}>
            <span className="bar cash" style={{ width: `${(r.report.cash / max) * 100}%` }} />
            <span className="muted">cash {mln(r.report.cash)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function BondsTab({ rows, onShowBonds }: { rows: BondRow[]; onShowBonds: () => void }) {
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
                    <strong>{r.code}</strong>
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

/** The figures the scorecard reads, in the order of the statements. */
const FIGURES: [string, string][] = [
  ["revenue", "Revenue"],
  ["ebit", "EBIT"],
  ["depreciation", "Depreciation"],
  ["interestExpense", "Interest expense"],
  ["netProfit", "Net profit"],
  ["totalAssets", "Total assets"],
  ["intangibleAssets", "Intangible assets"],
  ["currentAssets", "Current assets"],
  ["inventory", "Inventory"],
  ["cash", "Cash"],
  ["equity", "Equity"],
  ["minorityInterests", "Minority interests"],
  ["financialDebt", "Financial debt"],
  ["bonds", "Bonds"],
  ["currentLiabilities", "Current liabilities"],
  ["operatingCashFlow", "Operating cash flow"],
  ["capex", "Capex"],
];
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
  const shown = FIGURES.filter(([k]) => years.some((y) => y.figures[k]));
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
                  {y.months < 12 ? periodLabel(y.periodEnd, y.months) : `FY${y.periodEnd.slice(0, 4)}`}
                  <br />
                  <span className="muted">{y.scope}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(([k, label]) => (
              <tr key={k}>
                <td className="left">{label}</td>
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
            ))}
            <tr className="cat-review-row">
              <td className="left">Review</td>
              {years.map((y) => (
                <td key={y.period} data-testid="issuer-year-review" data-period={y.period}>
                  <span className={y.review.status === "flagged" ? "neg" : y.review.status === "hand-checked" ? "pos" : "muted"} title={y.review.note ?? (y.review.at ? `${y.review.at.slice(0, 10)} ${y.review.by ?? ""}` : "")}>
                    {REVIEW[y.review.status]}
                  </span>
                  <br />
                  {y.review.status !== "hand-checked" && (
                    <button type="button" className="link-button" disabled={busy === y.period} onClick={() => void review(y, "hand-checked")} title="The figures match the printed report" data-testid="issuer-year-check">
                      check
                    </button>
                  )}{" "}
                  {y.review.status !== "flagged" && (
                    <button type="button" className="link-button" disabled={busy === y.period} onClick={() => void review(y, "flagged")} title="Something's wrong in this year" data-testid="issuer-year-flag">
                      flag
                    </button>
                  )}{" "}
                  {y.review.status !== "parsed" && (
                    <button type="button" className="link-button" disabled={busy === y.period} onClick={() => void review(y, "parsed")} title="Back to parsed">
                      undo
                    </button>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td className="left">Statements</td>
              {years.map((y) => (
                <td key={y.period}>
                  <button type="button" className="link-button" onClick={() => setOpen({ period: y.period })} data-testid="issuer-year-lines">
                    {y.lines} lines
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {open && <YearLinesView entityId={d.company.entityId} period={open.period} field={open.field} onClose={() => setOpen(null)} />}
      {d.collected.length > 0 && <p className="muted cat-facts">Figures collected from the web (no report available): {d.collected.length} set{d.collected.length === 1 ? "" : "s"}, the latest {d.collected[0]!.at.slice(0, 10)}.</p>}
    </div>
  );
}

const STATEMENT: Record<string, string> = { balance: "Balance sheet", income: "Income statement", cashFlow: "Cash flow statement" };

/** A year's lines as printed: all of them, or the ones behind one figure. */
function YearLinesView({ entityId, period, field, onClose }: { entityId: string; period: string; field: string | undefined; onClose: () => void }) {
  const y = useApi<YearLines>(`/catalyst/entities/${encodeURIComponent(entityId)}/years/${encodeURIComponent(period)}`);
  if (!y.data) return <p className="muted">{y.error ?? "Loading…"}</p>;
  const source = field ? (y.data.figures[field]?.source ?? []) : [];
  const behind = (l: { code?: string; label: string }) => source.some((s) => (l.code && (s === l.code || s.endsWith(`/${l.code}`))) || s === l.label || s.endsWith(`/${l.label}`));
  const lines = field ? y.data.lines.filter(behind) : y.data.lines;
  const label = field ? FIGURES.find(([k]) => k === field)?.[1] : undefined;
  return (
    <section className="cat-lines" data-testid="issuer-lines">
      <p className="cat-facts">
        <strong>{label ? `${label}, FY${period.slice(0, 4)}` : `FY${period.slice(0, 4)}, ${period.split("#")[1]} accounts: the statements`}</strong> (m {y.data.currency}){" "}
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
                {these.map((l) => (
                  <tr key={`${l.order}`} className={l.item ? "" : "muted"}>
                    <td className="left">
                      {l.label}
                      {l.page ? <span className="muted"> · p. {l.page}</span> : null}
                    </td>
                    <td>{mln(l.value)}</td>
                  </tr>
                ))}
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
      </p>
      <MarkdownText text={latest!.markdown} />
      {earlier.map((j) => (
        <details key={j.at}>
          <summary>
            {j.at.slice(0, 10)} · {j.by}
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
                    {x.sourceUrl && (
                      <a className="muted" href={x.sourceUrl} target="_blank" rel="noopener noreferrer" title="Where it came from">
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
