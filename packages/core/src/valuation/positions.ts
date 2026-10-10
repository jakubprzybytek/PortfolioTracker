import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";

export interface Position {
  isin: string;
  quantity: number;
  /** Average-cost basis of the open quantity, in the instrument's currency (fees included). */
  cost: number;
  couponsReceived: number;
  firstDate: IsoDate;
}

/** Positions on `date` from all transactions up to and including it (average cost; sells reduce cost proportionally). */
export function positionsAt(transactions: TransactionItem[], date: IsoDate): Map<string, Position> {
  const positions = new Map<string, Position>();
  const sorted = [...transactions].filter((t) => t.date <= date && t.isin).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const t of sorted) {
    const isin = t.isin!;
    const p = positions.get(isin) ?? { isin, quantity: 0, cost: 0, couponsReceived: 0, firstDate: t.date };
    const qty = t.quantity ?? 0;
    switch (t.type) {
      case "BUY":
        p.quantity += qty;
        p.cost += -t.amount + (t.fee ?? 0); // amount is negative cash out
        break;
      case "SELL":
      case "REDEMPTION": {
        if (p.quantity > 0 && qty > 0) {
          const fraction = Math.min(qty, p.quantity) / p.quantity;
          p.cost -= p.cost * fraction;
          p.quantity -= Math.min(qty, p.quantity);
        }
        break;
      }
      case "COUPON":
      case "INTEREST":
        p.couponsReceived += t.amount;
        break;
      default:
        break;
    }
    positions.set(isin, p);
  }
  for (const [isin, p] of positions) {
    p.cost = Math.round(p.cost * 100) / 100;
    if (p.quantity <= 0 && p.couponsReceived === 0) positions.delete(isin);
  }
  return positions;
}

/** Earliest transaction date, or undefined when there are none. */
export function firstTransactionDate(transactions: TransactionItem[]): IsoDate | undefined {
  return transactions.map((t) => t.date).sort()[0];
}
