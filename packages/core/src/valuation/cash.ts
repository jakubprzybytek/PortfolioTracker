// Cash per account, from the transactions: the money that came in and went out of each account.
// BUY: `amount` is the trade value (negative) and the fee comes on top; every other type's `amount` is already
// the cash effect (SELL: received net of the fee; FEE/TAX: negative; DEPOSIT, COUPON, INTEREST: positive).

import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";

export const cashEffect = (t: Pick<TransactionItem, "type" | "amount" | "fee">): number => (t.type === "BUY" ? t.amount - (t.fee ?? 0) : t.amount);

/** Cash of every account that has transactions up to and including `date`. */
export function cashByAccount(transactions: TransactionItem[], date: IsoDate): Map<string, number> {
  const cash = new Map<string, number>();
  for (const t of transactions) {
    if (t.date > date) continue;
    cash.set(t.account, (cash.get(t.account) ?? 0) + cashEffect(t));
  }
  for (const [a, v] of cash) cash.set(a, round2(v));
  return cash;
}
