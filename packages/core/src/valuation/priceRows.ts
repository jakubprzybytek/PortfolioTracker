// Rows of the Prices view (Docs/ui.md): latest price of each held instrument, how old it is, and the change
// over a year. Bonds: clean price in % of nominal.

import type { IsoDate } from "../dates.ts";
import type { InstrumentItem, PriceItem } from "../db/items.ts";

export interface PriceRow {
  isin: string;
  code: string;
  name: string;
  type: InstrumentItem["type"];
  currency: string;
  price: number | null;
  priceDate: IsoDate | null;
  /** True when the price is older than `staleAfterDays`. */
  stale: boolean;
  /** Price on or before the same day a year earlier, and the change since (fraction, e.g. 0.021). */
  yearAgo: { date: IsoDate; price: number } | null;
  change1y: number | null;
}

const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function priceRows(
  instruments: InstrumentItem[],
  latest: Map<string, PriceItem>,
  yearAgo: Map<string, PriceItem>,
  today: IsoDate,
  staleAfterDays = 7,
): PriceRow[] {
  return instruments
    .map((i): PriceRow => {
      const now = latest.get(i.isin);
      const then = yearAgo.get(i.isin);
      return {
        isin: i.isin,
        code: i.code,
        name: i.name,
        type: i.type,
        currency: i.currency,
        price: now?.close ?? null,
        priceDate: now?.date ?? null,
        stale: !now || daysBetween(now.date, today) > staleAfterDays,
        yearAgo: then ? { date: then.date, price: then.close } : null,
        change1y: now && then && then.close ? Math.round((now.close / then.close - 1) * 10_000) / 10_000 : null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
