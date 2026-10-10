import type { PriceItem, PriceStatus } from "../db/items.ts";
import { keys } from "../db/items.ts";
import type { GpwDailyPrice } from "./parseHistory.ts";

export const GPW_VENUE = "XWAR";
export const GPW_SOURCE = "gpw-archive";

/** Converts parsed GPW rows into table items, carrying the last traded date forward for illiquid days. */
export function gpwRowsToPriceItems(rows: GpwDailyPrice[], status: PriceStatus, fetchedAt = new Date().toISOString()): PriceItem[] {
  const lastTraded = new Map<string, string>();
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      if (r.traded) lastTraded.set(r.isin, r.date);
      const lastTradeDate = lastTraded.get(r.isin);
      return {
        ...keys.price(r.isin, GPW_VENUE, r.date),
        isin: r.isin,
        venue: GPW_VENUE,
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        trades: r.trades,
        turnover: r.turnoverThousands * 1000,
        traded: r.traded,
        ...(lastTradeDate ? { lastTradeDate } : {}),
        currency: r.currency,
        source: GPW_SOURCE,
        fetchedAt,
        status,
      };
    });
}
