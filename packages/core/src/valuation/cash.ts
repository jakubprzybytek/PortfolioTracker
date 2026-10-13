// Cash per account and currency, from the transactions: the money that came in and went out of each account.
// Amounts and fees are in the transaction's currency. BUY: `amount` is the trade value (negative) and the fee comes
// on top; EXCHANGE: `amount` (negative) and its fee leave in `currency`, `toAmount` arrives in `toCurrency`; every
// other type's `amount` is already the cash effect (SELL: received net of the fee; FEE/TAX: negative; DEPOSIT, COUPON,
// INTEREST: positive).

import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";

type CashTx = Pick<TransactionItem, "type" | "amount" | "fee" | "currency" | "toAmount" | "toCurrency">;

/** What a transaction does to cash: [currency, change] pairs. */
export function cashEffects(t: CashTx): [string, number][] {
  const currency = t.currency || "PLN";
  if (t.type === "BUY") return [[currency, t.amount - (t.fee ?? 0)]];
  if (t.type === "EXCHANGE") return [[currency, t.amount - (t.fee ?? 0)], [t.toCurrency ?? currency, t.toAmount ?? 0]];
  return [[currency, t.amount]];
}

/** Cash of every account that has transactions up to and including `date`, per currency. */
export function cashByAccount(transactions: TransactionItem[], date: IsoDate): Map<string, Map<string, number>> {
  const cash = new Map<string, Map<string, number>>();
  for (const t of transactions) {
    if (t.date > date) continue;
    const acct = cash.get(t.account) ?? new Map<string, number>();
    for (const [c, v] of cashEffects(t)) acct.set(c, (acct.get(c) ?? 0) + v);
    cash.set(t.account, acct);
  }
  for (const acct of cash.values()) for (const [c, v] of acct) acct.set(c, round2(v));
  return cash;
}
