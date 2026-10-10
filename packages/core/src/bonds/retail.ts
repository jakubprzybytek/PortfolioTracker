// Polish retail treasury bonds (obligacje detaliczne: EDO, COI, ROD, ROS, TOS, …). Not traded, so their
// value is computed: nominal 100 PLN per bond plus interest accrued in yearly periods from the purchase date.
//   - first period: fixed rate from the series' terms of issue
//   - later periods: CPI y/y (published in the month before the period starts) + margin
//   - EDO/ROD/ROS/TOS capitalise interest yearly; COI/ROR/DOR pay it out
// Check the results against the Ministry's interest tables (obligacjeskarbowe.pl) before relying on them.

import { addDays, daysBetween, type IsoDate } from "../dates.ts";
import { round2 } from "./izIndex.ts";

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
  basis: "FIXED" | "CPI+margin" | "unknown";
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

/** Value of one retail bond on `date`. Interest accrues daily, ACT/ACT within each period. */
export function valueRetailBond(series: RetailBondSeries, periods: RetailRatePeriod[], date: IsoDate): RetailBondValue {
  if (date < series.purchaseDate) return { base: series.nominal, accrued: 0, value: series.nominal, paidOut: 0, problem: "before_purchase" };
  let base = series.nominal;
  let paidOut = 0;
  for (const p of periods) {
    if (date >= p.end) {
      const interest = base * p.rate * (daysBetween(p.start, p.end) / daysBetween(p.start, addMonths(p.start, 12)));
      if (series.capitalises) base = round2(base + interest);
      else paidOut += interest;
      continue;
    }
    const fraction = daysBetween(p.start, date) / daysBetween(p.start, addMonths(p.start, 12));
    const accrued = round2(base * p.rate * fraction);
    const result: RetailBondValue = { base, accrued, value: round2(base + accrued), paidOut: round2(paidOut), period: p };
    if (p.basis === "unknown") result.problem = "unknown_rate";
    return result;
  }
  return { base, accrued: 0, value: base, paidOut: round2(paidOut), problem: "matured" };
}

/** Yesterday's value is often what the bank shows; convenience for tests and checks. */
export const dayBefore = (date: IsoDate): IsoDate => addDays(date, -1);
