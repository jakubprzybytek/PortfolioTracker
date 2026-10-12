// Yahoo-specific pieces shared by the backfill and the daily ETF job. Prices are stored as traded:
// Yahoo's split-adjusted history is converted back with the instrument's recorded splits.

import { addDays, splitFactorAfter, today, unadjustSplits, type InstrumentItem, type IsoDate, type PriceItem, type PriceStatus } from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";
import { fetchYahooDaily, type YahooBar, type YahooDaily } from "./yahoo.ts";

export const YAHOO_SOURCE_ID = "yahoo";

export function yahooInstruments(instruments: InstrumentItem[]): InstrumentItem[] {
  return instruments.filter((i) => i.active && i.sourceIds[YAHOO_SOURCE_ID]);
}

const round4 = (v: number | null) => (v === null ? null : Number(v.toFixed(4)));

function toPriceItems(inst: InstrumentItem, bars: YahooBar[], status: PriceStatus, factor: (date: IsoDate) => number): PriceItem[] {
  const fetchedAt = new Date().toISOString();
  return bars.map((b) => {
    const f = factor(b.date);
    return {
      PK: `INST#${inst.isin}`,
      SK: `PX#${inst.venue}#${b.date}`,
      isin: inst.isin,
      venue: inst.venue,
      date: b.date,
      open: round4(b.open === null ? null : b.open * f),
      high: round4(b.high === null ? null : b.high * f),
      low: round4(b.low === null ? null : b.low * f),
      close: round4(b.close * f)!,
      volume: b.volume,
      trades: 0,
      turnover: 0,
      traded: true,
      currency: inst.currency,
      source: YAHOO_SOURCE_ID,
      fetchedAt,
      status,
    };
  });
}

function checkCurrency(inst: InstrumentItem, data: YahooDaily) {
  if (data.currency !== inst.currency) throw new Error(`${inst.code}: Yahoo ${data.symbol} is in ${data.currency}, the instrument in ${inst.currency}`);
}

/** Downloads one ETF's whole daily history and upserts it (as traded). Returns the date range and row count. */
export async function backfillYahooHistory(inst: InstrumentItem) {
  const symbol = inst.sourceIds[YAHOO_SOURCE_ID]!;
  const data = await fetchYahooDaily(symbol, "1990-01-01", today());
  checkCurrency(inst, data);
  await archiveRaw("yahoo-history", today(), `${symbol}.json`, new TextEncoder().encode(JSON.stringify(data)));
  if (data.closes.length === 0) throw new Error(`Yahoo ${symbol}: no prices`);
  const { undone } = unadjustSplits(data.closes, inst.splits);
  const written = await repo.putPrices(toPriceItems(inst, data.closes, "final", (d) => splitFactorAfter(undone, d)));
  const skipped = (inst.splits ?? []).filter((s) => !undone.includes(s)).map((s) => s.date);
  return {
    from: data.closes[0]!.date,
    to: data.closes.at(-1)!.date,
    rows: written,
    ...(undone.length || skipped.length ? { note: `splits converted back: ${undone.map((s) => s.date).join(", ") || "none"}${skipped.length ? `; not adjusted in the source: ${skipped.join(", ")}` : ""}` } : {}),
  };
}

const JUMP = 0.2; // a stored close moving more than this looks like an unrecorded split

/**
 * The last `days` of one ETF. Days already stored are only overwritten when the new close is close to the stored one:
 * after a split Yahoo rewrites its earlier closes, and an unrecorded split must not overwrite traded prices.
 */
export async function ingestYahooRecent(inst: InstrumentItem, end: IsoDate, days: number): Promise<{ written: number; warnings: string[] }> {
  const symbol = inst.sourceIds[YAHOO_SOURCE_ID]!;
  const start = addDays(end, -days);
  const data = await fetchYahooDaily(symbol, start, end);
  checkCurrency(inst, data);
  const stored = new Map((await repo.queryPrices(inst.isin, inst.venue, start, end)).map((p) => [p.date, p]));
  const items = toPriceItems(inst, data.closes, "final", () => 1);
  const warnings: string[] = [];
  const keep = items.filter((p) => {
    const old = stored.get(p.date);
    if (!old || Math.abs(p.close / old.close - 1) <= JUMP) return true;
    warnings.push(`${inst.code} ${p.date}: ${old.close} → ${p.close} (a split? record it in the instrument's "splits")`);
    return false;
  });
  return { written: await repo.putPrices(keep), warnings };
}
