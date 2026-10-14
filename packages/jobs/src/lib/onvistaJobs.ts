// Foreign government bonds (IBKR) from onvista, shared by the backfill and the daily job. Clean prices, % of nominal,
// from the exchange in the instrument's sourceIds.onvista (STU: Börse Stuttgart).

import { addDays, type InstrumentItem, type IsoDate, type PriceItem, type PriceStatus } from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";
import { fetchHistory, fetchSnapshot, type OnvistaBar, type OnvistaQuote } from "./onvista.ts";

export const ONVISTA_SOURCE_ID = "onvista";

export function onvistaInstruments(instruments: InstrumentItem[]): InstrumentItem[] {
  return instruments.filter((i) => i.active && i.sourceIds[ONVISTA_SOURCE_ID]);
}

function toPriceItems(inst: InstrumentItem, bars: OnvistaBar[], status: PriceStatus): PriceItem[] {
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
    source: ONVISTA_SOURCE_ID,
    fetchedAt,
    status,
  }));
}

/** The bond's quote on its exchange (and onvista's id for the history call). */
async function quoteOf(inst: InstrumentItem): Promise<{ idInstrument: string; quote: OnvistaQuote }> {
  const exchange = inst.sourceIds[ONVISTA_SOURCE_ID]!;
  const snap = await fetchSnapshot(inst.isin);
  if (!snap) throw new Error(`onvista doesn't know ${inst.isin}`);
  const quote = snap.quotes.find((q) => q.exchange === exchange);
  if (!quote) throw new Error(`onvista ${inst.isin}: no quote on ${exchange} (has ${snap.quotes.map((q) => q.exchange).join(", ") || "none"})`);
  if (quote.currency !== inst.currency) throw new Error(`onvista ${inst.isin}: quoted in ${quote.currency}, the instrument in ${inst.currency}`);
  return { idInstrument: snap.idInstrument, quote };
}

/** The bond's whole daily history on its exchange. Returns the date range and row count. */
export async function backfillOnvistaHistory(inst: InstrumentItem, today: IsoDate) {
  const { idInstrument, quote } = await quoteOf(inst);
  const bars = await fetchHistory(idInstrument, quote.idNotation, "2000-01-01");
  if (bars.length === 0) throw new Error(`onvista ${inst.isin}: no history on ${quote.exchange}`);
  await archiveRaw("onvista-history", today, `${inst.isin}.json`, new TextEncoder().encode(JSON.stringify(bars)));
  const rows = await repo.putPrices(toPriceItems(inst, bars, "final"));
  return { from: bars[0]!.date, to: bars.at(-1)!.date, rows };
}

/**
 * The last `days` of closes (final) plus today's quote (provisional: the history adds today's close the next day).
 * Returns the rows written.
 */
export async function ingestOnvistaRecent(inst: InstrumentItem, today: IsoDate, days: number): Promise<number> {
  const { idInstrument, quote } = await quoteOf(inst);
  const bars = await fetchHistory(idInstrument, quote.idNotation, addDays(today, -days));
  const items = toPriceItems(inst, bars, "final");
  if (quote.date === today && !bars.some((b) => b.date === today)) items.push(...toPriceItems(inst, [quote], "provisional"));
  return repo.putPrices(items);
}
