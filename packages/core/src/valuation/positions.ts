import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { toPlnD1, type FxHistory } from "./fx.ts";

/**
 * Units bought in one transaction and still held, with the cost of exactly those units, fees included: in PLN (a
 * purchase in another currency at the NBP rate of the day before, as Polish tax) and in the currency paid.
 */
export interface Lot {
  date: IsoDate;
  quantity: number;
  cost: number;
  costNative: number;
  currency: string;
}

/** One sale (or redemption) matched against the oldest lots: what it brought in and what those units cost. */
export interface Realisation {
  date: IsoDate;
  quantity: number;
  /** Cash received, net of the fee (PLN; in another currency at NBP D-1). */
  proceeds: number;
  /** Cost of the units sold (FIFO), PLN. */
  cost: number;
}

export interface Position {
  account: string;
  isin: string;
  quantity: number;
  /** Cost of the open quantity: the remaining lots (FIFO), fees included, PLN. */
  cost: number;
  /** The same in the currency paid, when every open lot was paid in one currency other than PLN. */
  costNative?: { amount: number; currency: string };
  /** Coupons, interest and dividends received, PLN (another currency at NBP D-1). */
  couponsReceived: number;
  firstDate: IsoDate;
  /** Open lots, oldest first. */
  lots: Lot[];
  realised: Realisation[];
}

/** Map key of a position: the same instrument in two accounts is two positions. */
export const positionKey = (account: string, isin: string): string => `${account}|${isin}`;

const round2 = (v: number) => Math.round(v * 100) / 100;
const EPS = 1e-9;

/**
 * Positions per account and ISIN on `date`, from all transactions up to and including it. Cost basis is FIFO, as in
 * the reference sheet and Polish tax: a sale takes the oldest lots first (a partly sold lot keeps its cost per unit).
 * Amounts in another currency than PLN count at the NBP rate of the day before (`fx`); without one, at the broker's
 * rate, else NaN.
 */
export function positionsAt(transactions: TransactionItem[], date: IsoDate, fx?: FxHistory): Map<string, Position> {
  const positions = new Map<string, Position>();
  // Within a day: buys first, sales last (a same-day sale of what was just bought, e.g. currency at IBKR, must not be
  // clipped to the holding before the buy).
  const rank = (t: TransactionItem) => (t.type === "BUY" ? 0 : t.type === "SELL" || t.type === "REDEMPTION" ? 2 : 1);
  const sorted = [...transactions]
    .filter((t) => t.date <= date && t.isin)
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const isin = t.isin!;
    const key = positionKey(t.account, isin);
    const p = positions.get(key) ?? { account: t.account, isin, quantity: 0, cost: 0, couponsReceived: 0, firstDate: t.date, lots: [], realised: [] };
    const qty = t.quantity ?? 0;
    const currency = t.currency || "PLN";
    const pln = (v: number) => (currency === "PLN" ? v : toPlnD1(v, currency, t.date, fx));
    switch (t.type) {
      case "BUY": {
        const paid = -t.amount + (t.fee ?? 0); // amount is negative cash out
        if (qty > 0) p.lots.push({ date: t.date, quantity: qty, cost: pln(paid), costNative: paid, currency });
        break;
      }
      case "SELL":
      case "REDEMPTION": {
        let left = Math.min(qty, p.lots.reduce((n, l) => n + l.quantity, 0));
        const sold = left;
        let cost = 0;
        while (left > EPS && p.lots.length > 0) {
          const lot = p.lots[0]!;
          const take = Math.min(left, lot.quantity);
          const part = lot.cost * (take / lot.quantity);
          cost += part;
          lot.cost -= part;
          lot.costNative -= lot.costNative * (take / lot.quantity);
          lot.quantity -= take;
          left -= take;
          if (lot.quantity <= EPS) p.lots.shift();
        }
        if (sold > 0) p.realised.push({ date: t.date, quantity: sold, proceeds: round2(pln(t.amount)), cost: round2(cost) });
        break;
      }
      case "SPLIT":
        // Every lot gets `ratio` times the units; its cost stays.
        for (const lot of p.lots) lot.quantity = Math.round(lot.quantity * (t.ratio ?? 1) * 1e6) / 1e6;
        break;
      case "COUPON":
      case "INTEREST":
      case "DIVIDEND":
        p.couponsReceived += pln(t.amount);
        break;
      default:
        break;
    }
    p.quantity = Math.round(p.lots.reduce((n, l) => n + l.quantity, 0) * 1e6) / 1e6;
    positions.set(key, p);
  }
  for (const [key, p] of positions) {
    p.cost = round2(p.lots.reduce((s, l) => s + l.cost, 0));
    const currencies = new Set(p.lots.map((l) => l.currency));
    const [only] = currencies;
    if (currencies.size === 1 && only !== "PLN") p.costNative = { amount: round2(p.lots.reduce((s, l) => s + l.costNative, 0)), currency: only! };
    if (p.quantity <= 0 && p.couponsReceived === 0) positions.delete(key);
  }
  return positions;
}

/** Earliest transaction date, or undefined when there are none. */
export function firstTransactionDate(transactions: TransactionItem[]): IsoDate | undefined {
  return transactions.map((t) => t.date).sort()[0];
}
