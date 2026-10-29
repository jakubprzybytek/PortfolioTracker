// Per-account summary for the Dashboard: money put in, what it's worth now, profit, income, costs and the
// money-weighted annual return (XIRR), and their total.

import type { IsoDate } from "../dates.ts";
import type { SnapshotItem, TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";
import { rateD1, rateOn, type FxHistory } from "./fx.ts";
import { positionsAt } from "./positions.ts";
import { xirr, type CashFlow } from "./xirr.ts";

export { xirr, type CashFlow } from "./xirr.ts";

export interface AccountSummary {
  account: string;
  /** Nothing left in it (no positions, no cash): `lastDate` is when it was emptied. */
  closed?: true;
  /** Date of its last transaction. */
  lastDate: IsoDate;
  /** Deposits − withdrawals. Transfers between your own accounts count on both sides. */
  netDeposits: number;
  /** Value of the open positions. */
  positions: number;
  cash: number;
  /** positions + cash */
  total: number;
  /** total − net deposits: everything gained, realised or not, after costs. */
  profit: number;
  /** Coupons, interest and dividends received. */
  income: number;
  /** Commissions on trades, fees and taxes paid. */
  costs: number;
  /**
   * Where the profit comes from: `unrealised` (open positions: value − FIFO cost), `realised` (sales and redemptions:
   * proceeds − FIFO cost), `income`, minus `fees` (fees and taxes not part of a trade: account fees, taxes, exchange
   * fees; trade commissions are in the cost or the proceeds), and `other`: the rest (exchange-rate effects on cash, a
   * broker's spread, positions without a price), so the parts add up to `profit`. All PLN, NBP D-1.
   */
  unrealised: number;
  realised: number;
  fees: number;
  other: number;
  /** Money-weighted annual return of the deposits and withdrawals plus today's total; null when not computable. */
  xirr: number | null;
  firstDate: IsoDate;
  /**
   * The same in the account's own currency (IBKR: EUR), when it isn't PLN: money in that currency counts as is,
   * the rest at the NBP rate of the day before; the total at today's rate.
   */
  base?: { currency: string; netDeposits: number; total: number; profit: number; xirr: number | null };
}

const INCOME = new Set<TransactionItem["type"]>(["COUPON", "INTEREST", "DIVIDEND"]);

/**
 * One row per account of the snapshot (and any account with transactions), sorted by name, plus their total.
 * Money in another currency than PLN counts at the NBP rate of the day before (`fx`), as Polish tax does; without a
 * rate, at the broker's (`fxRate`) or not at all.
 */
export function accountSummaries(
  snapshot: Pick<SnapshotItem, "date" | "holdings" | "accounts">,
  transactions: TransactionItem[],
  fx?: FxHistory,
): { accounts: AccountSummary[]; total: AccountSummary } {
  const date = snapshot.date;
  const txs = transactions.filter((t) => t.date <= date);
  const names = new Set([...Object.keys(snapshot.accounts ?? {}), ...snapshot.holdings.map((h) => h.account), ...txs.map((t) => t.account)]);
  /** `amount` of a transaction in `currency`, as `target` (PLN or a base currency) at the NBP rates of the day before. */
  const convert = (amount: number, currency: string, d: IsoDate, target = "PLN"): number => {
    if (currency === target) return amount;
    const pln = currency === "PLN" ? amount : amount * (rateD1(fx, currency, d) ?? NaN);
    return target === "PLN" ? pln : pln / (rateD1(fx, target, d) ?? NaN);
  };
  const plnOf = (t: TransactionItem, v = t.amount) => convert(v, t.currency || "PLN", t.date);
  const flowsOf = (ts: TransactionItem[], target = "PLN"): CashFlow[] =>
    ts.filter((t) => t.type === "DEPOSIT" || t.type === "WITHDRAWAL").map((t) => ({ date: t.date, amount: -convert(t.amount, t.currency || "PLN", t.date, target) }));

  // The account in its own currency: its deposits as made (others converted), its total at today's rate.
  const baseSummary = (currency: string, own: TransactionItem[], totalPln: number): NonNullable<AccountSummary["base"]> => {
    const flows = flowsOf(own, currency);
    const rate = rateOn(fx, currency, date)?.mid;
    const total = rate ? round2(totalPln / rate) : NaN;
    const netDeposits = round2(-flows.reduce((s, f) => s + f.amount, 0));
    return { currency, netDeposits, total, profit: round2(total - netDeposits), xirr: Number.isNaN(total) ? null : xirr([...flows, { date, amount: total }]) };
  };

  // Realised gains: every sale and redemption so far, FIFO (positions keep their sales even when closed).
  const realisedBy = new Map<string, number>();
  for (const p of positionsAt(txs, date, fx).values()) realisedBy.set(p.account, (realisedBy.get(p.account) ?? 0) + p.realised.reduce((s, r) => s + r.proceeds - r.cost, 0));

  const rows = [...names].sort((a, b) => a.localeCompare(b)).map((account): AccountSummary => {
    const own = txs.filter((t) => t.account === account);
    const info = snapshot.accounts?.[account];
    const positions = round2(snapshot.holdings.filter((h) => h.account === account).reduce((s, h) => s + (h.value ?? 0), 0));
    const cash = info?.cash ?? 0;
    const total = round2(positions + cash);
    const flows = flowsOf(own);
    const held = snapshot.holdings.some((h) => h.account === account && h.quantity !== 0);
    const closed = !held && cash === 0 && own.length > 0;
    const netDeposits = round2(-flows.reduce((s, f) => s + f.amount, 0));
    const profit = round2(total - netDeposits);
    const income = round2(own.filter((t) => INCOME.has(t.type)).reduce((s, t) => s + plnOf(t), 0));
    const unrealised = round2(snapshot.holdings.filter((h) => h.account === account && h.value !== null).reduce((s, h) => s + (h.value! - h.cost), 0));
    const realised = round2(realisedBy.get(account) ?? 0);
    const fees = round2(own.reduce((s, t) => s + plnOf(t, t.type === "FEE" || t.type === "TAX" ? -t.amount : t.type === "EXCHANGE" ? (t.fee ?? 0) : 0), 0));
    return {
      account,
      ...(closed ? { closed: true as const } : {}),
      netDeposits,
      positions,
      cash,
      total,
      profit,
      income,
      unrealised,
      realised,
      fees,
      other: round2(profit - unrealised - realised - income + fees),
      costs: round2(own.reduce((s, t) => s + plnOf(t, (t.fee ?? 0) + (t.type === "FEE" || t.type === "TAX" ? -t.amount : 0)), 0)),
      xirr: xirr([...flows, { date, amount: total }]),
      firstDate: own.map((t) => t.date).sort()[0] ?? date,
      lastDate: own.map((t) => t.date).sort().at(-1) ?? date,
      ...(info?.baseCurrency ? { base: baseSummary(info.baseCurrency, own, total) } : {}),
    };
  });

  const sum = (k: "netDeposits" | "positions" | "cash" | "total" | "profit" | "income" | "costs" | "unrealised" | "realised" | "fees" | "other") =>
    round2(rows.reduce((s, r) => s + r[k], 0));
  const total: AccountSummary = {
    account: "Total",
    netDeposits: sum("netDeposits"),
    positions: sum("positions"),
    cash: sum("cash"),
    total: sum("total"),
    profit: sum("profit"),
    income: sum("income"),
    costs: sum("costs"),
    unrealised: sum("unrealised"),
    realised: sum("realised"),
    fees: sum("fees"),
    other: sum("other"),
    xirr: xirr([...flowsOf(txs), { date, amount: sum("total") }]),
    firstDate: rows.map((r) => r.firstDate).sort()[0] ?? date,
    lastDate: rows.map((r) => r.lastDate).sort().at(-1) ?? date,
  };
  return { accounts: rows, total };
}

/**
 * Money put in minus taken out (deposits − withdrawals) up to and including each of `dates`, in PLN: other currencies
 * at the NBP rate of the day before, as in the account summary.
 */
export function netDepositsByDate(transactions: TransactionItem[], dates: IsoDate[], fx?: FxHistory): Map<IsoDate, number> {
  const flows = transactions
    .filter((t) => t.type === "DEPOSIT" || t.type === "WITHDRAWAL")
    .map((t) => ({ date: t.date, pln: (t.currency || "PLN") === "PLN" ? t.amount : t.amount * (rateD1(fx, t.currency, t.date) ?? NaN) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<IsoDate, number>();
  let i = 0;
  let sum = 0;
  for (const d of [...dates].sort()) {
    while (i < flows.length && flows[i]!.date <= d) sum += flows[i++]!.pln;
    out.set(d, round2(sum));
  }
  return out;
}
