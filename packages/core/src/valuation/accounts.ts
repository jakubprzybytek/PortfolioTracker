// Per-account summary for the Dashboard: money put in, what it's worth now, profit, income, costs and the
// money-weighted annual return (XIRR). Accounts not fully tracked are listed but left out of the total.

import type { IsoDate } from "../dates.ts";
import type { SnapshotItem, TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";
import { rateD1, rateOn, type FxHistory } from "./fx.ts";

export interface AccountSummary {
  account: string;
  /** What isn't tracked yet (the figures are then incomplete and not in the total). */
  incomplete?: string[];
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
  /** Money-weighted annual return of the deposits and withdrawals plus today's total; null when not computable. */
  xirr: number | null;
  firstDate: IsoDate;
  /**
   * The same in the account's own currency (IBKR: EUR), when it isn't PLN: money in that currency counts as is,
   * the rest at the NBP rate of the day before; the total at today's rate.
   */
  base?: { currency: string; netDeposits: number; total: number; profit: number; xirr: number | null };
}

export interface CashFlow {
  date: IsoDate;
  /** Into the portfolio negative (you pay in), out of it positive. */
  amount: number;
}

const DAY = 86_400_000;

/**
 * Annual rate r with Σ amount × (1 + r)^(−days/365) = 0, by bisection. Needs flows of both signs; returns null
 * otherwise or when no rate in (−99 %, +1000 %) solves it.
 */
export function xirr(flows: CashFlow[]): number | null {
  const fs = flows.filter((f) => f.amount !== 0);
  if (!fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return null;
  const t0 = Math.min(...fs.map((f) => Date.parse(f.date)));
  const years = fs.map((f) => (Date.parse(f.date) - t0) / DAY / 365);
  const npv = (r: number) => fs.reduce((s, f, i) => s + f.amount / (1 + r) ** years[i]!, 0);
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-10; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fLo * fMid <= 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return Number(((lo + hi) / 2).toFixed(6));
}

const INCOME = new Set<TransactionItem["type"]>(["COUPON", "INTEREST", "DIVIDEND"]);

/** One row per account of the snapshot (and any account with transactions), sorted by name, plus the total of the complete ones. */
/**
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

  const rows = [...names].sort((a, b) => a.localeCompare(b)).map((account): AccountSummary => {
    const own = txs.filter((t) => t.account === account);
    const info = snapshot.accounts?.[account];
    const positions = round2(snapshot.holdings.filter((h) => h.account === account).reduce((s, h) => s + (h.value ?? 0), 0));
    const cash = info?.cash ?? 0;
    const total = round2(positions + cash);
    const flows = flowsOf(own);
    const held = snapshot.holdings.some((h) => h.account === account && h.quantity !== 0);
    const closed = !info?.incomplete?.length && !held && cash === 0 && own.length > 0;
    const netDeposits = round2(-flows.reduce((s, f) => s + f.amount, 0));
    return {
      account,
      ...(info?.incomplete?.length ? { incomplete: info.incomplete } : {}),
      ...(closed ? { closed: true as const } : {}),
      netDeposits,
      positions,
      cash,
      total,
      profit: round2(total - netDeposits),
      income: round2(own.filter((t) => INCOME.has(t.type)).reduce((s, t) => s + plnOf(t), 0)),
      costs: round2(own.reduce((s, t) => s + plnOf(t, (t.fee ?? 0) + (t.type === "FEE" || t.type === "TAX" ? -t.amount : 0)), 0)),
      xirr: xirr([...flows, { date, amount: total }]),
      firstDate: own.map((t) => t.date).sort()[0] ?? date,
      lastDate: own.map((t) => t.date).sort().at(-1) ?? date,
      ...(info?.baseCurrency ? { base: baseSummary(info.baseCurrency, own, total) } : {}),
    };
  });

  const complete = rows.filter((r) => !r.incomplete);
  const sum = (k: "netDeposits" | "positions" | "cash" | "total" | "profit" | "income" | "costs") => round2(complete.reduce((s, r) => s + r[k], 0));
  const completeNames = new Set(complete.map((r) => r.account));
  const total: AccountSummary = {
    account: "Total",
    netDeposits: sum("netDeposits"),
    positions: sum("positions"),
    cash: sum("cash"),
    total: sum("total"),
    profit: sum("profit"),
    income: sum("income"),
    costs: sum("costs"),
    xirr: xirr([...flowsOf(txs.filter((t) => completeNames.has(t.account))), { date, amount: sum("total") }]),
    firstDate: complete.map((r) => r.firstDate).sort()[0] ?? date,
    lastDate: complete.map((r) => r.lastDate).sort().at(-1) ?? date,
  };
  return { accounts: rows, total };
}

/**
 * Money put in minus taken out (deposits − withdrawals) up to and including each of `dates`, in PLN: other currencies
 * at the NBP rate of the day before, as in the account summary. Accounts in `exclude` (not fully tracked) left out.
 */
export function netDepositsByDate(transactions: TransactionItem[], dates: IsoDate[], fx?: FxHistory, exclude: Set<string> = new Set()): Map<IsoDate, number> {
  const flows = transactions
    .filter((t) => (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") && !exclude.has(t.account))
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
