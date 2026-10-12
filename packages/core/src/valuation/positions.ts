import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";

/** Units bought in one transaction and still held, with the cost of exactly those units (PLN, fees included). */
export interface Lot {
  date: IsoDate;
  quantity: number;
  cost: number;
}

/** One sale (or redemption) matched against the oldest lots: what it brought in and what those units cost. */
export interface Realisation {
  date: IsoDate;
  quantity: number;
  /** Cash received, net of the fee. */
  proceeds: number;
  /** Cost of the units sold (FIFO). */
  cost: number;
}

export interface Position {
  account: string;
  isin: string;
  quantity: number;
  /** Cost of the open quantity: the remaining lots (FIFO), fees included. */
  cost: number;
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
 */
export function positionsAt(transactions: TransactionItem[], date: IsoDate): Map<string, Position> {
  const positions = new Map<string, Position>();
  const sorted = [...transactions].filter((t) => t.date <= date && t.isin).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const isin = t.isin!;
    const key = positionKey(t.account, isin);
    const p = positions.get(key) ?? { account: t.account, isin, quantity: 0, cost: 0, couponsReceived: 0, firstDate: t.date, lots: [], realised: [] };
    const qty = t.quantity ?? 0;
    switch (t.type) {
      case "BUY":
        if (qty > 0) p.lots.push({ date: t.date, quantity: qty, cost: -t.amount + (t.fee ?? 0) }); // amount is negative cash out
        break;
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
          lot.quantity -= take;
          left -= take;
          if (lot.quantity <= EPS) p.lots.shift();
        }
        if (sold > 0) p.realised.push({ date: t.date, quantity: sold, proceeds: round2(t.amount), cost: round2(cost) });
        break;
      }
      case "SPLIT":
        // Every lot gets `ratio` times the units; its cost stays.
        for (const lot of p.lots) lot.quantity = Math.round(lot.quantity * (t.ratio ?? 1) * 1e6) / 1e6;
        break;
      case "COUPON":
      case "INTEREST":
      case "DIVIDEND":
        p.couponsReceived += t.amount;
        break;
      default:
        break;
    }
    p.quantity = Math.round(p.lots.reduce((n, l) => n + l.quantity, 0) * 1e6) / 1e6;
    positions.set(key, p);
  }
  for (const [key, p] of positions) {
    p.cost = round2(p.lots.reduce((s, l) => s + l.cost, 0));
    if (p.quantity <= 0 && p.couponsReceived === 0) positions.delete(key);
  }
  return positions;
}

/** Earliest transaction date, or undefined when there are none. */
export function firstTransactionDate(transactions: TransactionItem[]): IsoDate | undefined {
  return transactions.map((t) => t.date).sort()[0];
}
