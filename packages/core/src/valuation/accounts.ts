// Per-account summary for the Dashboard: money put in, what it's worth now, profit, income, costs and the
// money-weighted annual return (XIRR). Accounts not fully tracked are listed but left out of the total.

import type { IsoDate } from "../dates.ts";
import type { SnapshotItem, TransactionItem } from "../db/items.ts";
import { round2 } from "../bonds/izIndex.ts";

export interface AccountSummary {
  account: string;
  /** What isn't tracked yet (the figures are then incomplete and not in the total). */
  incomplete?: string[];
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
export function accountSummaries(snapshot: Pick<SnapshotItem, "date" | "holdings" | "accounts">, transactions: TransactionItem[]): { accounts: AccountSummary[]; total: AccountSummary } {
  const date = snapshot.date;
  const txs = transactions.filter((t) => t.date <= date);
  const names = new Set([...Object.keys(snapshot.accounts ?? {}), ...snapshot.holdings.map((h) => h.account), ...txs.map((t) => t.account)]);
  const flowsOf = (ts: TransactionItem[]): CashFlow[] => ts.filter((t) => t.type === "DEPOSIT" || t.type === "WITHDRAWAL").map((t) => ({ date: t.date, amount: -t.amount }));

  const rows = [...names].sort((a, b) => a.localeCompare(b)).map((account): AccountSummary => {
    const own = txs.filter((t) => t.account === account);
    const info = snapshot.accounts?.[account];
    const positions = round2(snapshot.holdings.filter((h) => h.account === account).reduce((s, h) => s + (h.value ?? 0), 0));
    const cash = info?.cash ?? 0;
    const total = round2(positions + cash);
    const flows = flowsOf(own);
    const netDeposits = round2(-flows.reduce((s, f) => s + f.amount, 0));
    return {
      account,
      ...(info?.incomplete?.length ? { incomplete: info.incomplete } : {}),
      netDeposits,
      positions,
      cash,
      total,
      profit: round2(total - netDeposits),
      income: round2(own.filter((t) => INCOME.has(t.type)).reduce((s, t) => s + t.amount, 0)),
      costs: round2(own.reduce((s, t) => s + (t.fee ?? 0) + (t.type === "FEE" || t.type === "TAX" ? -t.amount : 0), 0)),
      xirr: xirr([...flows, { date, amount: total }]),
      firstDate: own.map((t) => t.date).sort()[0] ?? date,
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
  };
  return { accounts: rows, total };
}
