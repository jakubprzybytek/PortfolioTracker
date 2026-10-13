// NBP exchange rates for transactions and cash in other currencies than PLN.
//
// A transaction's PLN value uses the NBP mid rate of the last business day before it (D-1), as Polish tax does
// (PIT-38): the broker's own rate doesn't matter, its spread shows only in the account's profit (money in vs value).
// Holdings and cash are valued at the latest rate on or before the valuation day.

import type { IsoDate } from "../dates.ts";

/** NBP mid rates (PLN per unit) per currency, oldest first. */
export type FxHistory = Map<string, { date: IsoDate; mid: number }[]>;

/** Index of the last item dated strictly before `date` (inclusive: on or before), or -1. */
function lastIndex(items: { date: IsoDate }[], date: IsoDate, inclusive: boolean): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = items[mid]!.date;
    if (d < date || (inclusive && d === date)) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** PLN per unit of `currency` for a transaction on `date`: the NBP mid of the last business day before it. PLN: 1. */
export function rateD1(fx: FxHistory | undefined, currency: string, date: IsoDate): number | undefined {
  if (currency === "PLN") return 1;
  const items = fx?.get(currency);
  if (!items?.length) return undefined;
  const i = lastIndex(items, date, false);
  return i >= 0 ? items[i]!.mid : undefined;
}

/** PLN per unit of `currency` on `date` (latest on or before it), for valuing what is held that day. PLN: 1. */
export function rateOn(fx: FxHistory | undefined, currency: string, date: IsoDate): { mid: number; date: IsoDate } | undefined {
  if (currency === "PLN") return { mid: 1, date };
  const items = fx?.get(currency);
  if (!items?.length) return undefined;
  const i = lastIndex(items, date, true);
  return i >= 0 ? items[i] : undefined;
}

/**
 * `amount` in `currency` as PLN for a transaction on `date` (NBP D-1). Without a rate: the broker's `fallbackRate`
 * if given, else NaN (the caller flags it).
 */
export function toPlnD1(amount: number, currency: string, date: IsoDate, fx: FxHistory | undefined, fallbackRate?: number): number {
  const rate = rateD1(fx, currency, date) ?? fallbackRate;
  return rate === undefined ? NaN : amount * rate;
}
