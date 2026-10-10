// Indexation of Polish inflation-linked treasury bonds (IZ series), following the Ministry of
// Finance method. Verified to the 5th decimal against the MF's published ratios (see Docs/data-sources.md).

import { daysInMonth, shiftMonth, type IsoDate } from "../dates.ts";

/** One month of the reference index. `wr` = CPI m/m as a fraction (0.003 = +0.3 %). */
export interface ReferenceIndexMonth {
  month: string; // "YYYY-MM"
  wr: number;
  w: number; // chained index, 5 decimals: W(n) = ROUND(100 × Π(1 + wr_k), 5)
}

export const round5 = (x: number): number => Math.round(x * 1e5) / 1e5;
export const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Builds the chained index from monthly CPI changes, in month order starting at 100 (before the first month).
 * The product stays unrounded; only the published W(n) is rounded (sheet formula: ROUND(PRODUCT(100, …), 5)).
 */
export function buildReferenceIndex(monthly: { month: string; wr: number }[]): ReferenceIndexMonth[] {
  let product = 100;
  return [...monthly]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ month, wr }) => {
      product *= 1 + wr;
      return { month, wr, w: round5(product) };
    });
}

export type ReferenceIndex = ReadonlyMap<string, number>; // month -> W(n)

export function toReferenceIndex(months: ReferenceIndexMonth[]): ReferenceIndex {
  return new Map(months.map((m) => [m.month, m.w]));
}

/**
 * Daily reference index: in month M it starts at W(M−3) and moves linearly towards W(M−2).
 * Returns undefined when the needed months are missing.
 */
export function referenceIndexAt(index: ReferenceIndex, date: IsoDate): number | undefined {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const month = date.slice(0, 7);
  const a = index.get(shiftMonth(month, -3));
  const b = index.get(shiftMonth(month, -2));
  if (a === undefined || b === undefined) return undefined;
  return a + ((d - 1) / daysInMonth(y, m)) * (b - a);
}

/** Index ratio of an IZ bond on `date`: ROUND(Ref(date) / BaseRef, 5). */
export function indexRatioAt(index: ReferenceIndex, baseRef: number, date: IsoDate): number | undefined {
  const ref = referenceIndexAt(index, date);
  return ref === undefined ? undefined : round5(ref / baseRef);
}

/** The latest date the index can be computed for: last day of month (lastMonth + 2). */
export function referenceIndexCoverageEnd(index: ReferenceIndex): IsoDate | undefined {
  const months = [...index.keys()].sort();
  const last = months.at(-1);
  if (!last) return undefined;
  const target = shiftMonth(last, 2);
  const [y, m] = target.split("-").map(Number) as [number, number];
  return `${target}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}
