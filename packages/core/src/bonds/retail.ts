// Polish retail treasury bonds (obligacje detaliczne: EDO, COI, ROD, ROS, TOS, …). Not traded, so their
// value is computed: nominal 100 PLN per bond plus interest accrued in yearly periods from the purchase date.
//   - first period: fixed rate from the series' terms of issue
//   - later periods: CPI y/y (published in the month before the period starts) + margin
//   - EDO/ROD/ROS/TOS capitalise interest yearly; COI/ROR/DOR pay it out
// Check the results against the Ministry's interest tables (obligacjeskarbowe.pl) before relying on them.

import { addDays, daysBetween, type IsoDate } from "../dates.ts";
import type { RetailTerms } from "../mf/retailRates.ts";

export interface RetailBondSeries {
  series: string; // e.g. EDO0936
  kind: "EDO" | "COI" | "ROD" | "ROS" | "TOS" | "ROR" | "DOR" | "OTS";
  nominal: number; // 100 PLN
  purchaseDate: IsoDate; // interest starts here
  maturity: IsoDate;
  /** Annual rate of the first period, e.g. 0.0535. */
  firstRate: number;
  /** Margin over CPI y/y for later periods, e.g. 0.02 (EDO) / 0.015 (COI). Fixed-rate series: undefined. */
  margin?: number;
  capitalises: boolean; // EDO, ROD, ROS, TOS: yes; COI, ROR, DOR, OTS: no
  /** Early-redemption fee per bond, PLN (informational). */
  redemptionFee?: number;
  /** Months of the period (12 for yearly series; 1 for ROR/DOR). */
  periodMonths?: number;
}

export interface RetailRatePeriod {
  start: IsoDate;
  end: IsoDate;
  rate: number;
  basis: "FIXED" | "CPI+margin" | "PUBLISHED" | "unknown";
  cpiMonth?: string;
}

function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** "YYYY-MM" of the month before `date`'s month. */
const previousMonth = (date: IsoDate): string => addMonths(date.slice(0, 7) + "-01", -1).slice(0, 7);

/**
 * Builds the rate periods of a series. `cpiYoY` maps "YYYY-MM" (month of publication) to the CPI y/y change as a
 * fraction (0.049 = +4.9 %). Periods whose CPI isn't known yet get basis "unknown" and the latest known rate.
 */
export function retailRatePeriods(series: RetailBondSeries, cpiYoY: ReadonlyMap<string, number>): RetailRatePeriod[] {
  const months = series.periodMonths ?? 12;
  const periods: RetailRatePeriod[] = [];
  let start = series.purchaseDate;
  let lastRate = series.firstRate;
  for (let i = 0; start < series.maturity; i++) {
    const end = addMonths(series.purchaseDate, months * (i + 1)) <= series.maturity ? addMonths(series.purchaseDate, months * (i + 1)) : series.maturity;
    if (i === 0 || series.margin === undefined) {
      periods.push({ start, end, rate: series.firstRate, basis: "FIXED" });
    } else {
      const cpiMonth = previousMonth(start);
      const cpi = cpiYoY.get(cpiMonth);
      if (cpi === undefined) periods.push({ start, end, rate: lastRate, basis: "unknown", cpiMonth });
      else {
        // Deflation doesn't reduce the margin below itself: rate = max(cpi, 0) + margin.
        lastRate = Math.max(cpi, 0) + series.margin;
        periods.push({ start, end, rate: lastRate, basis: "CPI+margin", cpiMonth });
      }
    }
    start = end;
  }
  return periods;
}

export interface RetailBondValue {
  /** Nominal incl. capitalised interest of finished periods (for capitalising series), else 100. */
  base: number;
  /** Interest accrued in the current period, per bond. */
  accrued: number;
  /** base + accrued (COI: accrued only, since finished periods were paid out). */
  value: number;
  /** Interest paid out so far per bond (non-capitalising series). */
  paidOut: number;
  period?: RetailRatePeriod;
  problem?: "before_purchase" | "matured" | "unknown_rate";
}

/** Rounds to the grosz, immune to binary noise (100 × 6.3 % / 12 = 0.525 must give 0.53, not 0.52). */
export const grosz = (x: number): number => Math.round(Number((x * 100).toPrecision(12))) / 100;

/**
 * Value of one retail bond on `date`, the way the Ministry computes it (checked against every fully published
 * series in its file):
 *   - a period earns base × annual rate × months/12 (ROR0623 month 1: 100 × 5.25 % / 12 = 0.44);
 *   - capitalising series (EDO, ROD, ROS, TOS) compound unrounded and round only the amount shown;
 *     payout series (COI, ROR, DOR) pay each period's interest rounded to the grosz;
 *   - within a period, interest accrues by days elapsed / days in the period.
 */
export function valueRetailBond(series: RetailBondSeries, periods: RetailRatePeriod[], date: IsoDate): RetailBondValue {
  if (date < series.purchaseDate) return { base: series.nominal, accrued: 0, value: series.nominal, paidOut: 0, problem: "before_purchase" };
  const months = series.periodMonths ?? 12;
  let base = series.nominal;
  let paidOut = 0;
  for (const p of periods) {
    const periodInterest = base * p.rate * (months / 12);
    if (date >= p.end) {
      if (series.capitalises) base += periodInterest;
      else paidOut += grosz(periodInterest);
      continue;
    }
    const elapsed = daysBetween(p.start, date) / daysBetween(p.start, p.end);
    const accrued = series.capitalises ? base * p.rate * (months / 12) * elapsed : grosz(periodInterest) * elapsed;
    const result: RetailBondValue = { base: grosz(base), accrued: grosz(accrued), value: grosz(base + accrued), paidOut: grosz(paidOut), period: p };
    if (p.basis === "unknown") result.problem = "unknown_rate";
    return result;
  }
  return { base: grosz(base), accrued: 0, value: grosz(base), paidOut: grosz(paidOut), problem: "matured" };
}

/** One lot of a series: its terms from the Ministry file, interest starting on `valueDate` (the purchase date). */
export function lotSeries(terms: RetailTerms, valueDate: IsoDate): RetailBondSeries {
  return {
    series: terms.series,
    kind: terms.kind,
    nominal: 100,
    purchaseDate: valueDate,
    maturity: addMonths(valueDate, terms.termMonths),
    firstRate: terms.rates[0] ?? 0,
    ...(terms.margin !== undefined ? { margin: terms.margin } : {}),
    capitalises: terms.capitalises,
    periodMonths: terms.periodMonths,
  };
}

/** Periods with the rates the Ministry published; a period not published yet keeps the last rate, as "unknown". */
export function publishedRatePeriods(series: RetailBondSeries, rates: readonly (number | null)[]): RetailRatePeriod[] {
  const months = series.periodMonths ?? 12;
  const periods: RetailRatePeriod[] = [];
  let lastRate = rates[0] ?? series.firstRate;
  for (let i = 0, start = series.purchaseDate; start < series.maturity; i++) {
    const next = addMonths(series.purchaseDate, months * (i + 1));
    const end = next <= series.maturity ? next : series.maturity;
    const rate = rates[i];
    if (rate === null || rate === undefined) periods.push({ start, end, rate: lastRate, basis: "unknown" });
    else {
      lastRate = rate;
      periods.push({ start, end, rate, basis: "PUBLISHED" });
    }
    start = end;
  }
  return periods;
}

/** Yesterday's value is often what the bank shows; convenience for tests and checks. */
export const dayBefore = (date: IsoDate): IsoDate => addDays(date, -1);
