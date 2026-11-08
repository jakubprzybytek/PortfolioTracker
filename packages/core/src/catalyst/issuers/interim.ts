// Interim reports in the scorecard (Docs/catalyst.md, "Interim reports"; plan N8). The latest interim period newer
// than the last full year, of the same scope and standard:
// 1. its balance sheet replaces the year end's point-in-time items (debt, cash, equity, assets …);
// 2. its flows become the trailing 12 months: the full year + the year to date − the same period a year earlier (the
//    interim report's comparative column), item by item, only when all three are there (never part TTM, part year).
// The trend keeps comparing full years (company.ts). Interim periods are stored as rows like years, with `months` < 12.

import type { FinancialYear } from "../financials.ts";
import type { DbIssuerFinancialsRecord } from "./financialsRecord.ts";
import { reportedYear } from "./filedYears.ts";
import type { ReportedYear } from "./scorecard.ts";

type Key = Exclude<keyof ReportedYear, "year">;

/** Items at a date: from the interim's balance sheet. */
export const POINT_IN_TIME: Key[] = ["totalAssets", "intangibleAssets", "equity", "financialDebt", "cash", "currentAssets", "inventory", "currentLiabilities", "investmentProperty", "contractLiabilities", "leases", "bonds", "securitisation", "debtDueWithinYear", "bondsInOtherFinancialLiabilities"] as Key[];
/** Items over a period: trailing 12 months when the comparative is there. */
export const FLOWS: Key[] = ["revenue", "ebit", "depreciation", "interestExpense", "netProfit", "operatingCashFlow", "capex", "interestPaid", "profitBeforeTax", "writeDowns"] as Key[];

export interface InterimUse {
  periodEnd: string;
  months: number;
  /** "H1 2026", "Q1 2026", "Q1–Q3 2026". */
  label: string;
  /** The flows made trailing 12 months (empty: the flows stay the full year's). */
  ttm: string[];
  /** The comparative period the TTM took out ("H1 2025"), when there is one. */
  comparative?: string;
}

export const periodLabel = (periodEnd: string, months: number) => {
  const year = periodEnd.slice(0, 4);
  return months === 6 ? `H1 ${year}` : months === 3 ? `Q1 ${year}` : months === 9 ? `Q1–Q3 ${year}` : `${months} months to ${periodEnd}`;
};

const monthsBack = (day: string, months: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months + 1, 0));
  return target.toISOString().slice(0, 10);
};

/**
 * The years the scorecard takes with the latest interim period applied to the newest one, and what was used; or the
 * years unchanged with the reason none was used (no `interim` then).
 */
export function withInterim(rows: (FinancialYear | DbIssuerFinancialsRecord)[], years: ReportedYear[], latest: { periodEnd: string; scope: string }, lenderBonds = false): { years: ReportedYear[]; interim?: InterimUse; row?: FinancialYear; skipped?: string } {
  const full = rows.find((r) => r.months >= 12 && r.periodEnd === latest.periodEnd && r.scope === latest.scope);
  const candidates = rows.filter((r) => r.months < 12 && r.periodEnd > latest.periodEnd && r.periodEnd <= monthsBack(latest.periodEnd, -12)).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  const interim = candidates[0];
  if (!full || !interim || years.length === 0) return { years };
  const label = periodLabel(interim.periodEnd, interim.months);
  if (interim.scope !== full.scope) return { years, skipped: `${label} is ${interim.scope} accounts, the year ${full.scope}: the scorecard stays on the full year` };
  if (interim.standard !== full.standard) return { years, skipped: `${label} is under another standard than the year: the scorecard stays on the full year` };
  const now = reportedYear(interim as DbIssuerFinancialsRecord, lenderBonds);
  const fy = years[0]!;
  const adjusted: ReportedYear = { ...fy };
  const set = (k: Key, v: number | null | undefined) => {
    (adjusted as Record<string, number | null | undefined>)[k] = v;
  };
  for (const k of POINT_IN_TIME) if (typeof now[k] === "number") set(k, now[k]);
  // The same months a year earlier, same scope: the interim report's comparative column.
  const before = rows.find((r) => r.months === interim.months && r.scope === interim.scope && r.periodEnd === monthsBack(interim.periodEnd, 12));
  const ttm: string[] = [];
  if (before) {
    const then = reportedYear(before as DbIssuerFinancialsRecord, lenderBonds);
    for (const k of FLOWS) {
      const [a, b, c] = [fy[k], now[k], then[k]];
      if (typeof a === "number" && typeof b === "number" && typeof c === "number") {
        set(k, a + b - c);
        ttm.push(k);
      }
    }
  }
  return {
    years: [adjusted, ...years.slice(1)],
    row: interim,
    interim: { periodEnd: interim.periodEnd, months: interim.months, label, ttm, ...(before ? { comparative: periodLabel(before.periodEnd, before.months) } : {}) },
  };
}
