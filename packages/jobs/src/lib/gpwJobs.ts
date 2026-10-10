// GPW-specific pieces shared by the backfill and the daily job.

import {
  GpwInstrumentType,
  downloadGpwDay,
  downloadGpwHistory,
  gpwRowsToPriceItems,
  parseGpwHistoryXls,
  today,
  type InstrumentItem,
  type IsoDate,
  type PriceStatus,
} from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";

export const GPW_SOURCE_ID = "gpw";

export function gpwInstruments(instruments: InstrumentItem[]): InstrumentItem[] {
  return instruments.filter((i) => i.active && i.sourceIds[GPW_SOURCE_ID]);
}

/** Downloads one bond's whole history and upserts it. Returns the date range and row count. */
export async function backfillGpwHistory(inst: InstrumentItem, status: PriceStatus = "final") {
  const code = inst.sourceIds[GPW_SOURCE_ID]!;
  const file = await downloadGpwHistory(code, GpwInstrumentType.treasuryBonds, { log: console.log });
  await archiveRaw("gpw-history", today(), file.fileName, file.content);
  const rows = parseGpwHistoryXls(file.content).filter((r) => r.isin === inst.isin);
  if (rows.length === 0) throw new Error(`GPW history for ${code} contains no rows for ISIN ${inst.isin}`);
  const written = await repo.putPrices(gpwRowsToPriceItems(rows, status));
  return { from: rows[0]!.date, to: rows.at(-1)!.date, rows: written };
}

/**
 * Downloads one session's all-bonds file and upserts the rows of the tracked instruments.
 * Returns the number of rows written, or null when there was no session that day.
 */
export async function ingestGpwDay(date: IsoDate, tracked: InstrumentItem[], status: PriceStatus): Promise<number | null> {
  const file = await downloadGpwDay(date, GpwInstrumentType.treasuryBonds, { log: console.log });
  if (!file) return null;
  await archiveRaw("gpw-day", date, file.fileName, file.content);
  const wanted = new Set(tracked.map((i) => i.isin));
  const rows = parseGpwHistoryXls(file.content).filter((r) => wanted.has(r.isin));
  if (rows.length === 0) return 0;
  // The day file has no history, so carry the last traded date from what's stored.
  const items = gpwRowsToPriceItems(rows, status);
  for (const item of items) {
    if (!item.traded) {
      const prev = await repo.latestPrice(item.isin, item.venue, item.date);
      if (prev?.lastTradeDate) item.lastTradeDate = prev.lastTradeDate;
    }
  }
  return repo.putPrices(items);
}
