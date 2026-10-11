// Retail treasury bonds are valued per lot: each purchase earns interest from its own start date (valueDate),
// so two purchases of the same series a few days apart are worth slightly different amounts.

import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { grosz, lotSeries, publishedRatePeriods, valueRetailBond } from "../bonds/retail.ts";
import type { RetailTerms } from "../mf/retailRates.ts";

export interface RetailLot {
  valueDate: IsoDate;
  quantity: number;
}

/** Open lots of one account's position on `date`: buys add a lot, sells and redemptions take from the oldest (FIFO). */
export function retailLotsAt(transactions: TransactionItem[], date: IsoDate): RetailLot[] {
  const lots: RetailLot[] = [];
  const sorted = transactions.filter((t) => t.date <= date).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const qty = t.quantity ?? 0;
    if (t.type === "BUY" && qty > 0) lots.push({ valueDate: t.valueDate ?? t.date, quantity: qty });
    if ((t.type === "SELL" || t.type === "REDEMPTION") && qty > 0) {
      let left = qty;
      while (left > 0 && lots.length > 0) {
        const take = Math.min(left, lots[0]!.quantity);
        lots[0]!.quantity -= take;
        left -= take;
        if (lots[0]!.quantity === 0) lots.shift();
      }
    }
  }
  return lots;
}

export interface RetailPositionValue {
  quantity: number;
  value: number;
  /** Per bond, averaged over the lots: capitalised nominal and interest of the current period. */
  nominal: number;
  accruedInterest: number;
  /** Current period's rate and the previous one, from the oldest lot. */
  rate: { current: number; previous: number | null } | undefined;
  flags: string[];
}

export function valueRetailLots(terms: RetailTerms, lots: RetailLot[], date: IsoDate): RetailPositionValue {
  let quantity = 0;
  let value = 0;
  let base = 0;
  let accrued = 0;
  let rate: RetailPositionValue["rate"];
  const flags = new Set<string>();
  for (const lot of lots) {
    const series = lotSeries(terms, lot.valueDate);
    const periods = publishedRatePeriods(series, terms.rates);
    const v = valueRetailBond(series, periods, date);
    quantity += lot.quantity;
    value += v.value * lot.quantity;
    base += v.base * lot.quantity;
    accrued += v.accrued * lot.quantity;
    if (v.problem === "unknown_rate") flags.add("rate_pending");
    if (v.problem === "matured") flags.add("matured");
    if (!rate && v.period) {
      const i = periods.indexOf(v.period);
      rate = { current: v.period.rate, previous: i > 0 ? periods[i - 1]!.rate : null };
    }
  }
  return {
    quantity,
    value: grosz(value),
    nominal: quantity ? grosz(base / quantity) : 0,
    accruedInterest: quantity ? grosz(accrued / quantity) : 0,
    rate,
    flags: [...flags],
  };
}
