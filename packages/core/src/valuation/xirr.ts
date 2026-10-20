// Money-weighted annual return (XIRR): of an account from its deposits and withdrawals (accounts.ts), and of a position
// or a group of positions from their own cash flows (buys, sales, redemptions, coupons, dividends, fees and taxes on
// them) plus their value at the end. Light on imports: the Holdings view computes groups' XIRR in the browser.

import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { cashEffects } from "./cash.ts";
import { toPlnD1, type FxHistory } from "./fx.ts";
import { positionKey } from "./positions.ts";

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

/** A position's cash flow on one day: [date, PLN], money into the position negative (a buy), out of it positive. */
export type PositionFlow = [IsoDate, number];

/**
 * Each position's cash flows (key: `positionKey`), from its transactions up to and including `date`: what each did to
 * cash (a buy with its fee, a sale net of its fee, coupons, dividends, fees and taxes booked on the position), in PLN
 * at the NBP rate of the day before (`fx`), as everywhere else; a write-off as 0. One flow per day, oldest first.
 */
export function positionFlows(transactions: TransactionItem[], date: IsoDate, fx?: FxHistory): Record<string, PositionFlow[]> {
  const byKey = new Map<string, Map<IsoDate, number>>();
  for (const t of transactions) {
    if (!t.isin || t.date > date) continue;
    const pln = cashEffects(t).reduce((s, [c, v]) => s + (c === "PLN" ? v : toPlnD1(v, c, t.date, fx, t.fxRate)), 0);
    // A write-off moves no cash, but it's the day the position ended: kept as a flow of 0.
    if (pln === 0 && t.type !== "WRITE_OFF") continue;
    const key = positionKey(t.account, t.isin);
    const days = byKey.get(key) ?? new Map<IsoDate, number>();
    days.set(t.date, (days.get(t.date) ?? 0) + pln);
    byKey.set(key, days);
  }
  const out: Record<string, PositionFlow[]> = {};
  for (const [key, days] of byKey)
    out[key] = [...days].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => [d, Math.round(v * 100) / 100]);
  return out;
}

/** Shorter than this (first flow to the end), an annual rate says little: a few days' move times a hundred. */
export const XIRR_MIN_DAYS = 30;

/**
 * XIRR of one or more positions together: their flows plus `value` (what they're worth on `date`) as the last inflow.
 * Closed (`value` 0): the flows alone, ending at the last one; nothing came back (a write-off): −100 %. Null when held
 * under XIRR_MIN_DAYS, with no flows, or not computable (e.g. a value missing: NaN).
 */
export function positionsXirr(flows: PositionFlow[][], value: number, date: IsoDate): number | null {
  const all = flows.flat();
  if (all.length === 0 || Number.isNaN(value)) return null;
  const first = all.reduce((d, [x]) => (x < d ? x : d), all[0]![0]);
  const end = value !== 0 ? date : all.reduce((d, [x]) => (x > d ? x : d), first);
  if (value === 0 && !all.some(([, v]) => v > 0)) return -1;
  if ((Date.parse(end) - Date.parse(first)) / DAY < XIRR_MIN_DAYS) return null;
  return xirr([...all.map(([d, amount]) => ({ date: d, amount })), { date, amount: value }]);
}
