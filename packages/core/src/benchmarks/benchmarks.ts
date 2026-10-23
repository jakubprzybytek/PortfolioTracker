// Benchmarks for the Performance view: what the portfolio's return compares with. A fixed list (road map 10);
// their daily closes are kept apart from the instruments (`BENCH#<id>` in `market`), so they never show as holdings,
// prices or backups. Light on imports: the web app reads the list from this file
// (`@portfolio/core/benchmarks/benchmarks`).

import { lotSeries, publishedRatePeriods, valueRetailBond } from "../bonds/retail.ts";
import type { IsoDate } from "../dates.ts";
import type { RetailTerms } from "../mf/retailRates.ts";
import { rateOn, type FxHistory } from "../valuation/fx.ts";

export interface Benchmark {
  id: string;
  label: string;
  /** A table column's header. */
  short: string;
  /** What it is, for tooltips. */
  note: string;
  source: "gpw" | "yahoo";
  /** GPW: the index's name in the archive (indices, `type` 1); Yahoo: the symbol. */
  symbol: string;
  /** GPW: the index's ISIN (the archive's file is checked against it). */
  isin?: string;
  currency: string;
}

/** Both count dividends (WIG is a total-return index, IWDA accumulates), so they compare fairly with the portfolio. */
export const BENCHMARKS: Benchmark[] = [
  { id: "WIG", label: "WIG", short: "WIG", note: "WIG: every company on GPW's main market, dividends reinvested (GPW)", source: "gpw", symbol: "WIG", isin: "PL9999999995", currency: "PLN" },
  {
    id: "MSCI_WORLD",
    label: "MSCI World",
    short: "World",
    note: "MSCI World: iShares Core MSCI World (IWDA, accumulating, Euronext Amsterdam), EUR in PLN at NBP (Yahoo)",
    source: "yahoo",
    symbol: "IWDA.AS",
    currency: "EUR",
  },
];

/**
 * A mixed benchmark, computed rather than fetched: 40 % MSCI World and 60 % EDO (the 10-year inflation-linked retail
 * bond), weights kept every day (each day's return is the weighted sum of the parts'). The EDO part is the series on
 * sale on its first day, bought that day and held (the Ministry's published rates; a period not published yet keeps
 * the last rate).
 */
export const MIX = {
  id: "MIX_40_60",
  label: "40/60 World/EDO",
  short: "40/60",
  note: "40 % MSCI World, 60 % EDO (10-year inflation-linked retail bond, the series on sale on the first day, held), weights kept every day",
  world: 0.4,
  edo: 0.6,
} as const;

/** One EDO bond bought on `start` (terms of that month's series): its value on each of `dates` from `start` on. */
export function edoValues(terms: RetailTerms, start: IsoDate, dates: IsoDate[]): BenchmarkPoint[] {
  const series = lotSeries(terms, start);
  const periods = publishedRatePeriods(series, terms.rates);
  return dates.filter((d) => d >= start).map((date) => ({ date, value: valueRetailBond(series, periods, date).value }));
}

/**
 * Parts mixed at fixed weights, rebalanced daily: from 100 on the first of the first part's days on which every part
 * has a value, each next day grows by Σ weight × the part's growth since the day before.
 */
export function mixSeries(parts: { weight: number; points: BenchmarkPoint[] }[]): BenchmarkPoint[] {
  const out: BenchmarkPoint[] = [];
  let prev: number[] | undefined;
  let index = 100;
  for (const { date } of parts[0]?.points ?? []) {
    const values = parts.map((p) => benchmarkAt(p.points, date));
    if (values.some((v) => v === undefined)) continue;
    const now = values as number[];
    if (prev) index *= 1 + parts.reduce((sum, p, i) => sum + p.weight * (now[i]! / prev![i]! - 1), 0);
    prev = now;
    out.push({ date, value: Number(index.toFixed(6)) });
  }
  return out;
}

/** The margin over inflation of the "inflation + margin" line: about what the 10-year retail bond (EDO) pays. */
export const CPI_MARGIN = 0.02;

/** One day of a benchmark in PLN. */
export interface BenchmarkPoint {
  date: IsoDate;
  value: number;
}

/** A benchmark's closes in PLN: closes in another currency at that day's NBP rate (the latest on or before it); a day without a rate is left out. */
export function benchmarkInPln(closes: { date: IsoDate; close: number }[], currency: string, fx: FxHistory): BenchmarkPoint[] {
  const out: BenchmarkPoint[] = [];
  for (const c of [...closes].sort((a, b) => a.date.localeCompare(b.date))) {
    const rate = rateOn(fx, currency, c.date);
    if (rate) out.push({ date: c.date, value: Number((c.close * rate.mid).toFixed(4)) });
  }
  return out;
}

/** The value on `date` (the latest on or before it); undefined before the first. `series` oldest first. */
export function benchmarkAt(series: BenchmarkPoint[], date: IsoDate): number | undefined {
  let lo = 0;
  let hi = series.length - 1;
  let found: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.date <= date) {
      found = series[mid]!.value;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** The benchmark's return from `from` to `to`; null when it has no value on `from` (it starts later). */
export function benchmarkReturn(series: BenchmarkPoint[], from: IsoDate, to: IsoDate): number | null {
  const a = benchmarkAt(series, from);
  const b = benchmarkAt(series, to);
  return a === undefined || b === undefined ? null : Number((b / a - 1).toFixed(6));
}
