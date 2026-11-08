// One company's analysis, computed from its stored years when read (Docs/catalyst.md, "Scorecard"): its rule set, the
// six dimensions with trend arrows, refinancing and data confidence. CatalystViewer's getIssuerProfiles, for one
// company, with two changes: six dimensions (Financial trend turned into arrows on Debt burden and Profitability), and
// the company's own fields (industry, kind of financial company, override) instead of name lists.

import type { FinancialYear } from "../financials.ts";
import { dataConfidence, type ConfidenceSource } from "./confidence.ts";
import { filedYears } from "./filedYears.ts";
import { withInterim, type InterimUse } from "./interim.ts";
import { latestReport, refinancing, refinancingDimension, type ListedBond, type Rates, type Refinancing } from "./refinancing.ts";
import { isInFundamentalScope } from "./scope.ts";
import { financeRuleSetFor, ruleSetFor, scorecardFromReportedYears, type DimensionResult, type FinanceRuleSet, type FundamentalScorecard, type MetricResult, type RuleSet, type Signal } from "./scorecard.ts";

export type Arrow = "up" | "flat" | "down";

/** A dimension of the six, with its trend arrow when its trend metrics could be computed (three years or more). */
export type Dimension = DimensionResult & { trend?: { arrow: Arrow; metrics: MetricResult[] } };

/** The six dimensions, in their fixed order. */
export const DIMENSIONS = ["Debt Burden", "Debt Service", "Liquidity", "Profitability", "Asset Coverage", "Refinancing"] as const;
const TREND = "Financial Trend";
/** The trend metrics and the dimension each describes. */
const TREND_OF: Record<string, (typeof DIMENSIONS)[number]> = {
  "Net Debt/EBITDA Trend": "Debt Burden",
  "EBITDA Margin Trend": "Profitability",
  "Revenue CAGR": "Profitability",
};

/** A trend metric's signal as a direction: green improving, yellow flat, red worsening. */
const arrowOf = (signals: Signal[]): Arrow | undefined => {
  const known = signals.filter((s) => s !== "na");
  if (known.length === 0) return undefined;
  if (known.includes("red")) return "down";
  return known.every((s) => s === "green") ? "up" : "flat";
};

/**
 * Six dimensions from CatalystViewer's seven: Financial trend's metrics become arrows on the dimensions they describe.
 * An arrow doesn't change a dimension's colour; the judgement weighs it.
 */
export function sixDimensions(dimensions: DimensionResult[]): Dimension[] {
  const trend = dimensions.find((d) => d.name === TREND);
  const out: Dimension[] = dimensions.filter((d) => d.name !== TREND).map((d) => ({ ...d }));
  for (const d of out) {
    const metrics = (trend?.metrics ?? []).filter((m) => TREND_OF[m.name] === d.name);
    const arrow = arrowOf(metrics.map((m) => m.signal));
    if (arrow) d.trend = { arrow, metrics };
  }
  return out.sort((a, b) => DIMENSIONS.indexOf(a.name as (typeof DIMENSIONS)[number]) - DIMENSIONS.indexOf(b.name as (typeof DIMENSIONS)[number]));
}

export interface CompanyProfile {
  /** From the fixed list (§6): Developer, Construction, Retail, Finance, … */
  industry?: string;
  /** A lender's kind, set by you (a Finance company has no scorecard without it). */
  financeRuleSet?: FinanceRuleSet;
  /** Rules that fit the business model better than the industry's, with the reason. */
  ruleSetOverride?: { ruleSet: RuleSet; reason: string };
}

export interface CompanyAnalysis {
  /** scored; no-report (no full year stored); out-of-scope (banks, insurers, the State, municipalities; a Finance company without its kind). */
  state: "scored" | "no-report" | "out-of-scope";
  ruleSet: RuleSet;
  scorecard?: Omit<FundamentalScorecard, "dimensions"> & { dimensions: Dimension[] };
  source?: { format: string; scope: string; latestPeriodEnd: string; years: number; interim?: InterimUse; interimSkipped?: string };
  refinancing?: Refinancing;
}

/**
 * The rule set: a lender's kind (yours, or CatalystViewer's list by listed name until it's set), an override, the
 * industry's rules, else general.
 */
export function companyRuleSet(profile: CompanyProfile, names: string[]): { ruleSet: RuleSet; lender: boolean } {
  const lender = profile.financeRuleSet ?? names.map((n) => financeRuleSetFor(n)).find(Boolean);
  if (lender) return { ruleSet: lender, lender: true };
  return { ruleSet: profile.ruleSetOverride?.ruleSet ?? names.map((n) => ruleSetFor(profile.industry, n)).find((r) => r !== "general") ?? ruleSetFor(profile.industry), lender: false };
}

export function companyAnalysis(profile: CompanyProfile, names: string[], years: FinancialYear[], bonds: ListedBond[], rates: Rates, today: string): CompanyAnalysis {
  const { ruleSet, lender } = companyRuleSet(profile, names);
  // A lender's bonds may sit in "other financial liabilities" (filedYears).
  const filed = filedYears(years, lender && bonds.length > 0);
  // The latest interim period newer than the year (interim.ts): its balance sheet, and TTM flows.
  const inter = filed ? withInterim(years, filed.years, { periodEnd: filed.latestPeriodEnd, scope: filed.scope }, lender && bonds.length > 0) : undefined;
  const annual = latestReport(years);
  // Refinancing: cash at the interim's date when there is one.
  const report = annual && inter?.row ? { ...annual, periodEnd: inter.row.periodEnd, figures: { ...annual.figures, ...(inter.row.figures.cash ? { cash: inter.row.figures.cash } : {}), ...(inter.row.figures.bonds ? { bonds: inter.row.figures.bonds } : {}) } } : annual;
  const refi = bonds.length || report ? refinancing(bonds, report, today, rates) : undefined;
  const base = { ruleSet, ...(refi ? { refinancing: refi } : {}) };
  if (!lender && !isInFundamentalScope(profile.industry)) return { state: "out-of-scope", ...base };
  if (!filed || !inter) return { state: "no-report", ...base };
  const annualCard = scorecardFromReportedYears("", filed.years, ruleSet);
  // The trend compares full years: an interim changes the snapshot, never the arrows.
  const snapshot = inter.interim ? scorecardFromReportedYears("", inter.years, ruleSet) : annualCard;
  const scorecard = inter.interim ? { ...snapshot, dimensions: snapshot.dimensions.map((d) => (d.name === TREND ? (annualCard.dimensions.find((x) => x.name === TREND) ?? d) : withInterimNote(d, inter.interim!, filed.latestPeriodEnd))) } : annualCard;
  const source: ConfidenceSource = { kind: "filing", format: filed.format, scope: filed.scope, periodEnd: filed.latestPeriodEnd, years: filed.years.length };
  const confidence = dataConfidence(scorecard, source, today);
  if (inter.interim) confidence.facts.push(`${inter.interim.label}: interim figures, usually unaudited (half-years of listed companies are reviewed)`);
  if (inter.skipped) confidence.facts.push(inter.skipped);
  const refiDimension = refi && refinancingDimension(refi);
  return {
    state: "scored",
    ...base,
    scorecard: { ...scorecard, confidence, dimensions: sixDimensions(refiDimension ? [...scorecard.dimensions, refiDimension] : scorecard.dimensions) },
    source: { format: filed.format, scope: filed.scope, latestPeriodEnd: filed.latestPeriodEnd, years: filed.years.length, ...(inter.interim ? { interim: inter.interim } : {}), ...(inter.skipped ? { interimSkipped: inter.skipped } : {}) },
  };
}

const BALANCE_DIMENSIONS = ["Debt Burden", "Liquidity", "Asset Coverage"];
const FLOW_DIMENSIONS = ["Debt Service", "Profitability"];

/** Which figures a dimension used: the year, the interim balance sheet, TTM flows. */
function withInterimNote(d: DimensionResult, i: InterimUse, yearEnd: string): DimensionResult {
  const fy = `FY${yearEnd.slice(0, 4)}`;
  const note = BALANCE_DIMENSIONS.includes(d.name)
    ? `balance sheet at ${i.periodEnd} (${i.label}, interim)`
    : FLOW_DIMENSIONS.includes(d.name)
      ? i.ttm.length
        ? `flows over the 12 months to ${i.periodEnd} (${fy} + ${i.label} − ${i.comparative}); balance sheet at ${i.periodEnd}`
        : `flows of ${fy} (no comparative period in the ${i.label} report for TTM); balance sheet at ${i.periodEnd}`
      : undefined;
  return note ? { ...d, notes: [...(d.notes ?? []), note] } : d;
}
