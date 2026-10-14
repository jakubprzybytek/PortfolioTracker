// Rows of the Prices view (Docs/ui.md): latest price of each held instrument, how old it is, and the change
// over a year. Bonds: clean price in % of nominal. Retail bonds have no market price: their row shows the
// current period's interest rate and the previous one instead (`rate`).

import type { IsoDate } from "../dates.ts";
import type { InstrumentItem, PriceItem } from "../db/items.ts";
import { splitFactorAfter } from "../prices/splits.ts";

export interface PriceRow {
  isin: string;
  code: string;
  name: string;
  type: InstrumentItem["type"];
  currency: string;
  price: number | null;
  priceDate: IsoDate | null;
  /** True when the price is older than `staleAfterDays` (never for manual prices: they're entered when known). */
  stale: boolean;
  /** Price entered by hand (venue MANUAL). */
  manual?: boolean;
  /** Price calculated, not quoted (venue CALC: IBKR bills and bonds without a quote source). */
  calculated?: boolean;
  /** Price on or before the same day a year earlier (on today's share basis after a split), and the change since (fraction, e.g. 0.021). */
  yearAgo: { date: IsoDate; price: number } | null;
  change1y: number | null;
  /** Retail bonds: annual rate now and in the previous period (instead of a price). */
  rate?: { current: number; previous: number | null };
}

const daysBetween = (a: IsoDate, b: IsoDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function priceRows(
  instruments: InstrumentItem[],
  latest: Map<string, PriceItem>,
  yearAgo: Map<string, PriceItem>,
  today: IsoDate,
  staleAfterDays = 7,
  rates: Map<string, { current: number; previous: number | null }> = new Map(),
): PriceRow[] {
  return instruments
    .map((i): PriceRow => {
      if (i.type === "BOND_RETAIL") {
        const rate = rates.get(i.isin);
        return { isin: i.isin, code: i.code, name: i.name, type: i.type, currency: i.currency, price: null, priceDate: null, stale: false, yearAgo: null, change1y: null, ...(rate ? { rate } : {}) };
      }
      const now = latest.get(i.isin);
      const raw = yearAgo.get(i.isin);
      // A split in between: the year-ago price on today's share basis.
      const f = raw && now ? splitFactorAfter(i.splits, raw.date) / splitFactorAfter(i.splits, now.date) : 1;
      const then = raw && f !== 1 ? { ...raw, close: Number((raw.close / f).toFixed(6)) } : raw;
      return {
        isin: i.isin,
        code: i.code,
        name: i.name,
        type: i.type,
        currency: i.currency,
        price: now?.close ?? null,
        priceDate: now?.date ?? null,
        stale: !now || (now.venue !== "MANUAL" && daysBetween(now.date, today) > staleAfterDays),
        ...(now?.venue === "MANUAL" ? { manual: true } : {}),
        ...(i.venue === "CALC" ? { calculated: true } : {}),
        yearAgo: then ? { date: then.date, price: then.close } : null,
        change1y: now && then && then.close ? Math.round((now.close / then.close - 1) * 10_000) / 10_000 : null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
