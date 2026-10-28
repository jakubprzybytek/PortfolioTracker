// IBKR's mark prices (Flex Web Service), shared by the daily job and the backfill. Instruments priced from IBKR have
// venue IBKR and their conid in sourceIds.ibkr (US T-bills: no quote anywhere else). The statement also checks the
// bonds priced elsewhere (onvista): IBKR's mark against the stored close of the same day.

import {
  addDays,
  IBKR_SOURCE_ID,
  ibkrPrices,
  parseFlexStatement,
  tradeDayPrices,
  type FlexStatement,
  type InstrumentItem,
  type IsoDate,
} from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";
import { fetchFlexStatement, flexToken } from "./ibkrFlex.ts";

export { IBKR_SOURCE_ID };
export const IBKR_VENUE = "IBKR";
/** Flex statements cover at most 365 days. */
const MAX_DAYS = 365;
/** IBKR's mark and the onvista close of the same day further apart than this (points of % of nominal) is reported. */
const CHECK_TOLERANCE = 0.05;

export function ibkrInstruments(instruments: InstrumentItem[]): InstrumentItem[] {
  return instruments.filter((i) => i.active && i.sourceIds[IBKR_SOURCE_ID]);
}

/** The statement for [from, to], kept in the raw archive. Throws on a stage without a token. */
export async function loadStatement(from: IsoDate, to: IsoDate, archiveDay: IsoDate): Promise<FlexStatement> {
  const token = flexToken();
  const queryId = process.env.IBKR_FLEX_QUERY_ID;
  if (!token || !queryId) throw new Error("IBKR Flex isn't set up on this stage (secret IbkrFlexToken, IBKR_FLEX_QUERY_ID)");
  const start = from < addDays(to, -MAX_DAYS + 1) ? addDays(to, -MAX_DAYS + 1) : from;
  const xml = await fetchFlexStatement({ token, queryId, from: start, to });
  await archiveRaw("ibkr-flex", archiveDay, `positions-${start}-${to}.xml`, new TextEncoder().encode(xml));
  return parseFlexStatement(xml);
}

/** Writes the IBKR prices of the given instruments found in the statement. Returns the rows written per instrument. */
export async function storeIbkrPrices(instruments: InstrumentItem[], statement: FlexStatement): Promise<Map<string, number>> {
  const fetchedAt = new Date().toISOString();
  const written = new Map<string, number>();
  for (const inst of instruments) {
    const items = ibkrPrices(inst, statement, fetchedAt);
    written.set(inst.isin, items.length ? await repo.putPrices(items) : 0);
  }
  return written;
}

/** The instrument's history from IBKR: from its first trade (at most a year back) to the last business day. */
export async function backfillIbkrHistory(inst: InstrumentItem, today: IsoDate) {
  const to = addDays(today, -1);
  const firstTrade = inst.pricePath?.[0]?.date;
  const from = firstTrade && firstTrade > addDays(to, -MAX_DAYS + 1) ? firstTrade : addDays(to, -MAX_DAYS + 1);
  const statement = await loadStatement(from, to, today);
  const fetchedAt = new Date().toISOString();
  const items = ibkrPrices(inst, statement, fetchedAt);
  if (items.length === 0) throw new Error(`IBKR has no prices for ${inst.isin} between ${from} and ${to} (not held then?)`);
  items.unshift(...tradeDayPrices(inst, items[0]!.date, fetchedAt));
  const rows = await repo.putPrices(items);
  return { from: items[0]!.date, to: items.at(-1)!.date, rows };
}

/**
 * Positions at IBKR that the app doesn't know, and bonds priced elsewhere whose stored close differs from IBKR's mark
 * on the statement's last day: one line each, for the job's note.
 */
export async function checkAgainstIbkr(instruments: InstrumentItem[], statement: FlexStatement): Promise<string[]> {
  const notes: string[] = [];
  const byIsin = new Map(instruments.map((i) => [i.isin, i]));
  for (const p of statement.open) {
    const inst = byIsin.get(p.isin);
    if (!inst) {
      if (p.assetCategory !== "CASH") notes.push(`${p.isin} (${p.description}) held at IBKR, not an instrument in the app`);
      continue;
    }
    if (inst.venue === IBKR_VENUE) continue;
    const stored = (await repo.queryPrices(inst.isin, inst.venue, p.reportDate, p.reportDate))[0];
    if (!stored) continue; // no close that day (a holiday on its exchange): nothing to compare
    const diff = Math.abs(stored.close - p.markPrice);
    if (diff > CHECK_TOLERANCE) notes.push(`${inst.code}: ${inst.venue} close ${stored.close} vs IBKR mark ${p.markPrice} on ${p.reportDate}`);
  }
  return notes;
}
