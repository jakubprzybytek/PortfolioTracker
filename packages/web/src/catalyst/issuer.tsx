// A company's scorecard in small (Docs/catalyst.md, "UI"): the six dots in their fixed order with the trend arrows,
// the rule set and the confidence; "AI analysis off" until it's switched on; the labels the issuer screens share.
import type { Arrow, IssuerSignals, Signal } from "./types.ts";

/** The six dimensions in their fixed order, with the letters the column's header shows. */
export const DIMENSIONS = [
  { name: "Debt Burden", short: "B", label: "Debt burden" },
  { name: "Debt Service", short: "S", label: "Debt service" },
  { name: "Liquidity", short: "L", label: "Liquidity" },
  { name: "Profitability", short: "P", label: "Profitability" },
  { name: "Asset Coverage", short: "A", label: "Asset coverage" },
  { name: "Refinancing", short: "R", label: "Refinancing" },
] as const;

export const RULE_SETS: Record<string, string> = {
  general: "general",
  developer: "developer",
  contractor: "contractor",
  consumer: "consumer and services",
  collector: "debt collector",
  leasing: "leasing and factoring",
  investment: "investment firm",
};

export const SIGNAL_LABEL: Record<Signal, string> = { green: "green", yellow: "yellow", red: "red", na: "n/a" };
export const ARROW: Record<Arrow, string> = { up: "↑", flat: "→", down: "↓" };
export const ARROW_LABEL: Record<Arrow, string> = { up: "improving", flat: "flat", down: "worsening" };

const dimensionLabel = (name: string) => DIMENSIONS.find((d) => d.name === name)?.label ?? name;

/** The six dots (a fixed order), each dimension's arrow after its dot. Faded at low confidence. */
export function SignalDots({ signals, extra = [] }: { signals: IssuerSignals; extra?: string[] }) {
  const title = [...signals.dimensions.map((d) => `${dimensionLabel(d.name)}: ${SIGNAL_LABEL[d.signal]}${d.arrow ? `, ${ARROW_LABEL[d.arrow]}` : ""}`), ...extra].join("\n");
  return (
    <span className={`cat-dots${signals.confidence === "low" ? " faded" : ""}`} role="img" aria-label={title.replace(/\n/g, "; ")} title={title} data-testid="issuer-dots">
      {signals.dimensions.map((d) => (
        <span key={d.name} className="cat-dim">
          <span className={`cat-dot ${d.signal}`} />
          {d.arrow && d.arrow !== "flat" && <span className={`cat-arrow ${d.arrow}`}>{ARROW[d.arrow]}</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * What the issuer column shows for a bond's company. `compact` (the tables): the dots only, with the rule set, the
 * confidence and the latest year in their tooltip.
 */
export function IssuerSignalsCell({ ai, signals, offSince, compact = false }: { ai: boolean | undefined; signals: IssuerSignals | undefined; offSince?: string | undefined; compact?: boolean }) {
  // Off: the default. Switched off again after a scorecard: the scorecard stays, marked as not kept current.
  if (!ai && signals?.state !== "scored") return <span className="muted cat-ai-off" data-testid="issuer-ai-off">AI analysis off</span>;
  if (!signals || signals.state === "no-report") return <span className="muted">no report yet</span>;
  if (signals.state === "out-of-scope") return <span className="muted">not scored</span>;
  const offNote = !ai ? `AI analysis off${offSince ? ` since ${offSince}` : ""}: not kept current` : undefined;
  if (compact) {
    const extra = [`${RULE_SETS[signals.ruleSet] ?? signals.ruleSet} rules`, signals.confidence ? `${signals.confidence} confidence` : "", signals.latestPeriodEnd ? `FY${signals.latestPeriodEnd.slice(0, 4)}${signals.interim ? ` + ${signals.interim.label}${signals.interim.ttm ? " (TTM)" : ""}` : ""}` : "", offNote ?? ""].filter(Boolean);
    return (
      <span className="cat-signals">
        <SignalDots signals={signals} extra={extra} />
        {offNote && <span className="muted cat-rule">off</span>}
      </span>
    );
  }
  return (
    <span className="cat-signals">
      <SignalDots signals={signals} />
      <span className="muted cat-rule">
        {RULE_SETS[signals.ruleSet] ?? signals.ruleSet}
        {signals.confidence && ` · ${signals.confidence}`}
        {offNote && <span title={offNote}> · off</span>}
      </span>
    </span>
  );
}

/** A short label for a state without colours. */
export const stateLabel = (s: IssuerSignals | undefined, ai: boolean | undefined) =>
  !ai && s?.state !== "scored" ? "AI analysis off" : !s || s.state === "no-report" ? "no report yet" : s.state === "out-of-scope" ? "not scored" : "scored";

/** Scorecard filters (in the URL): no red; no red in debt service and refinancing; a chosen dimension green. */
export const SCORECARD_FILTERS = [
  { value: "nored", label: "No red" },
  { value: "nored-sr", label: "No red in debt service and refinancing" },
  ...DIMENSIONS.map((d) => ({ value: `green-${d.short}`, label: `${d.label} green` })),
];

export function scorecardMatches(s: IssuerSignals | undefined, filter: string): boolean {
  if (s?.state !== "scored") return false;
  const of = (short: string) => s.dimensions.find((d) => d.name === DIMENSIONS.find((x) => x.short === short)?.name)?.signal;
  if (filter === "nored") return s.dimensions.every((d) => d.signal !== "red");
  if (filter === "nored-sr") return of("S") !== "red" && of("R") !== "red";
  if (filter.startsWith("green-")) return of(filter.slice(6)) === "green";
  return true;
}

export const CONFIDENCE_FILTERS = [
  { value: "medium", label: "Medium or better" },
  { value: "high", label: "High" },
];
const CONFIDENCE_ORDER = ["low", "medium", "high"];
export const confidenceAtLeast = (s: IssuerSignals | undefined, min: string) => !!s?.confidence && CONFIDENCE_ORDER.indexOf(s.confidence) >= CONFIDENCE_ORDER.indexOf(min);

export const STATE_FILTERS = [
  { value: "scored", label: "Scored" },
  { value: "no-report", label: "No report yet" },
  { value: "not-scored", label: "Not scored" },
  { value: "off", label: "AI analysis off" },
];
export function stateMatches(s: IssuerSignals | undefined, ai: boolean | undefined, filter: string): boolean {
  const state = stateLabel(s, ai);
  return filter === "scored" ? state === "scored" : filter === "no-report" ? state === "no report yet" : filter === "not-scored" ? state === "not scored" : filter === "off" ? !ai : true;
}

/** The colour of one dimension, for the chart's dots. */
export const SIGNAL_COLOR: Record<Signal | "none", string> = { green: "var(--pos)", yellow: "var(--brand)", red: "var(--neg)", na: "var(--faint)", none: "var(--border)" };
export const dimensionSignal = (s: IssuerSignals | undefined, short: string): Signal | "none" => {
  const name = DIMENSIONS.find((d) => d.short === short)?.name;
  return s?.state === "scored" ? (s.dimensions.find((d) => d.name === name)?.signal ?? "na") : "none";
};

/** A scorecard's order for sorting: fewer reds, then fewer yellows, first when sorted descending; unscored last. */
export const signalsScore = (s: IssuerSignals | undefined): number | null =>
  s?.state === "scored" ? 100 - 10 * s.dimensions.filter((d) => d.signal === "red").length - s.dimensions.filter((d) => d.signal === "yellow").length : null;
