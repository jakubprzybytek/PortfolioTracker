// Benchmarks for the Performance view: what the portfolio's return compares with. A fixed list (road map 10);
// their daily closes are kept apart from the instruments (`BENCH#<id>` in `market`), so they never show as holdings,
// prices or backups. Light on imports: the web app reads the list from this file
// (`@portfolio/core/benchmarks/benchmarks`).

import type { IsoDate } from "../dates.ts";
import { rateOn, type FxHistory } from "../valuation/fx.ts";

export interface Benchmark {
  id: string;
  label: string;
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
  { id: "WIG", label: "WIG", note: "WIG: every company on GPW's main market, dividends reinvested (GPW)", source: "gpw", symbol: "WIG", isin: "PL9999999995", currency: "PLN" },
  {
    id: "MSCI_WORLD",
    label: "MSCI World",
    note: "MSCI World: iShares Core MSCI World (IWDA, accumulating, Euronext Amsterdam), EUR in PLN at NBP (Yahoo)",
    source: "yahoo",
    symbol: "IWDA.AS",
    currency: "EUR",
  },
];

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
