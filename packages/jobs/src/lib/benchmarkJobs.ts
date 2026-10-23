// Daily closes of the benchmarks (core/benchmarks/benchmarks.ts): WIG from GPW's archive (the index's whole history
// is one file, there's no shorter one), MSCI World from Yahoo. The first run loads the whole history; later runs
// write only the days that are new or changed in the last fortnight.

import { addDays, downloadGpwHistory, GpwInstrumentType, parseGpwHistoryXls, today, type Benchmark, type BenchmarkPriceItem, type IsoDate } from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";
import { fetchYahooDaily } from "./yahoo.ts";

const LOOKBACK_DAYS = 14;
const FIRST_DAY = "1990-01-01";

type Close = { date: IsoDate; close: number };
type Row = Omit<BenchmarkPriceItem, "PK" | "SK">;

/** The fetched closes on or after `from` that aren't stored, or are stored with another close. */
export function changedCloses(fetched: Close[], stored: Close[], from: IsoDate): Close[] {
  const have = new Map(stored.map((s) => [s.date, s.close]));
  return fetched.filter((c) => c.date >= from && have.get(c.date) !== c.close);
}

async function fetchCloses(b: Benchmark, from: IsoDate): Promise<{ closes: Close[]; currency: string }> {
  if (b.source === "gpw") {
    const file = await downloadGpwHistory(b.symbol, GpwInstrumentType.indices, { log: console.log });
    await archiveRaw("gpw-index-history", today(), file.fileName, file.content);
    const rows = parseGpwHistoryXls(file.content).filter((r) => r.isin === b.isin);
    if (rows.length === 0) throw new Error(`GPW history for ${b.symbol} has no rows for ISIN ${b.isin}`);
    return { closes: rows.map((r) => ({ date: r.date, close: r.close })), currency: "PLN" };
  }
  const data = await fetchYahooDaily(b.symbol, from, today());
  await archiveRaw("yahoo-benchmark", today(), `${b.symbol}.json`, new TextEncoder().encode(JSON.stringify(data)));
  return { closes: data.closes.map((c) => ({ date: c.date, close: c.close })), currency: data.currency };
}

/** Fetches one benchmark and stores what's new or changed. Returns the rows written and a note. */
export async function ingestBenchmark(b: Benchmark): Promise<{ written: number; note: string }> {
  const latest = await repo.latestBenchmarkPrice(b.id);
  const from = latest ? addDays(latest.date, -LOOKBACK_DAYS) : FIRST_DAY;
  const { closes, currency } = await fetchCloses(b, from);
  if (currency !== b.currency) throw new Error(`${b.label}: ${b.symbol} is in ${currency}, expected ${b.currency}`);
  const stored = latest ? await repo.queryBenchmarkPrices(b.id, from, today()) : [];
  const fetchedAt = new Date().toISOString();
  const rows: Row[] = changedCloses(closes, stored, from).map((c) => ({ id: b.id, date: c.date, close: c.close, currency: b.currency, source: b.source, fetchedAt }));
  const written = rows.length ? await repo.putBenchmarkPrices(rows) : 0;
  const last = closes.at(-1)?.date ?? "none";
  return { written, note: `${b.label}: ${written} rows${latest ? "" : ` (history from ${closes[0]?.date ?? "–"})`}, last ${last}` };
}
