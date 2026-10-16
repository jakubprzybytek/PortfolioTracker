// Retail treasury bonds are valued per lot: each purchase earns interest from its own start date (valueDate),
// so two purchases of the same series a few days apart are worth slightly different amounts.

import type { TransactionItem } from "../db/items.ts";
import { addDays, type IsoDate } from "../dates.ts";
import { grosz, lotSeries, publishedRatePeriods, valueRetailBond } from "../bonds/retail.ts";
import type { RetailTerms } from "../mf/retailRates.ts";

export interface RetailLot {
  valueDate: IsoDate;
  quantity: number;
}

/** Open lots of one account's position on `date`: buys add a lot, sells and redemptions take from the oldest (FIFO). */
export function retailLotsAt(transactions: TransactionItem[], date: IsoDate): RetailLot[] {
  const lots: RetailLot[] = [];
  // Within a day: buys before sales (as in positionsAt).
  const rank = (t: TransactionItem) => (t.type === "BUY" ? 0 : t.type === "SELL" || t.type === "REDEMPTION" || t.type === "WRITE_OFF" ? 2 : 1);
  const sorted = transactions.filter((t) => t.date <= date).sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const qty = t.quantity ?? 0;
    if (t.type === "BUY" && qty > 0) lots.push({ valueDate: t.valueDate ?? t.date, quantity: qty });
    if ((t.type === "SELL" || t.type === "REDEMPTION" || t.type === "WRITE_OFF") && qty > 0) {
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

/**
 * Daily value per bond of a retail position (all lots in `transactions`, averaged), for the days it was held
 * between `from` and `to`: the "price" line of a bond that isn't traded. Nominal 100, so it reads like % of nominal.
 */
export function retailValueHistory(terms: RetailTerms, transactions: TransactionItem[], from: IsoDate, to: IsoDate): { date: IsoDate; value: number }[] {
  const first = transactions.filter((t) => t.type === "BUY").map((t) => t.valueDate ?? t.date).sort()[0];
  if (!first) return [];
  const out: { date: IsoDate; value: number }[] = [];
  for (let date = from > first ? from : first; date <= to; date = addDays(date, 1)) {
    const lots = retailLotsAt(transactions, date);
    const r = valueRetailLots(terms, lots, date);
    if (r.quantity > 0) out.push({ date, value: grosz(r.value / r.quantity) });
  }
  return out;
}
