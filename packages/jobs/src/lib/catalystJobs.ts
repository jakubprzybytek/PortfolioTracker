// Catalyst corporate bonds from BiznesRadar, shared by the backfill and the daily job. Clean prices, % of nominal.

import type { InstrumentItem, IsoDate, PriceItem, PriceStatus } from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";
import { fetchHistoryPage, fetchQuotePage, parseHistoryPage, parseQuotePage, type BrBar } from "./biznesradar.ts";

export const BIZNESRADAR_SOURCE_ID = "biznesradar";
const PAUSE_MS = 2000; // be gentle: one page every 2 s

const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

export function catalystInstruments(instruments: InstrumentItem[]): InstrumentItem[] {
  return instruments.filter((i) => i.active && i.sourceIds[BIZNESRADAR_SOURCE_ID]);
}

function toPriceItems(inst: InstrumentItem, bars: BrBar[], status: PriceStatus): PriceItem[] {
  const fetchedAt = new Date().toISOString();
  return bars.map((b) => ({
    PK: `INST#${inst.isin}`,
    SK: `PX#${inst.venue}#${b.date}`,
    isin: inst.isin,
    venue: inst.venue,
    date: b.date,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    trades: 0,
    turnover: 0,
    traded: b.volume > 0,
    currency: inst.currency,
    source: BIZNESRADAR_SOURCE_ID,
    fetchedAt,
    status,
  }));
}

/** Every history page of one bond (oldest sessions are on the last page). Returns the date range and row count. */
export async function backfillBiznesradarHistory(inst: InstrumentItem, today: IsoDate) {
  const code = inst.sourceIds[BIZNESRADAR_SOURCE_ID]!;
  const first = await fetchHistoryPage(code);
  if (!first) throw new Error(`BiznesRadar has no page for ${code} (no longer listed?)`);
  const { bars, lastPage } = parseHistoryPage(first, code);
  const all = [...bars];
  for (let page = 2; page <= lastPage; page++) {
    await pause();
    const html = await fetchHistoryPage(code, page);
    if (!html) break;
    all.push(...parseHistoryPage(html, code).bars);
  }
  if (all.length === 0) throw new Error(`BiznesRadar ${code}: no sessions`);
  await archiveRaw("biznesradar-history", today, `${code}.json`, new TextEncoder().encode(JSON.stringify(all)));
  const written = await repo.putPrices(toPriceItems(inst, all, "final"));
  const dates = all.map((b) => b.date).sort();
  return { from: dates[0]!, to: dates.at(-1)!, rows: written };
}

/**
 * The latest history page (final: the last ~50 sessions, up to yesterday) plus today's quote (provisional; the
 * history page adds it the next day). Returns the rows written.
 */
export async function ingestBiznesradarRecent(inst: InstrumentItem, today: IsoDate): Promise<number> {
  const code = inst.sourceIds[BIZNESRADAR_SOURCE_ID]!;
  const page = await fetchHistoryPage(code);
  if (!page) throw new Error(`BiznesRadar has no page for ${code} (no longer listed?)`);
  const bars = parseHistoryPage(page, code).bars;
  await pause();
  const quotePage = await fetchQuotePage(code);
  const quote = quotePage ? parseQuotePage(quotePage) : undefined;
  const items = toPriceItems(inst, bars, "final");
  if (quote && quote.date === today && !bars.some((b) => b.date === today)) items.push(...toPriceItems(inst, [quote], "provisional"));
  return repo.putPrices(items);
}
