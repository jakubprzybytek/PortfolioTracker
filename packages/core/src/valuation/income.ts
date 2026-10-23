// Income per calendar year (Performance, "Income by year"): coupons, dividends and interest received, in PLN at the
// NBP rate of the business day before each (as the Dashboard's income and Polish tax). Every account counts.

import type { TransactionItem } from "../db/items.ts";
import { toPlnD1, type FxHistory } from "./fx.ts";

export interface YearIncome {
  year: number;
  coupons: number;
  dividends: number;
  interest: number;
  total: number;
}

const KIND = { COUPON: "coupons", DIVIDEND: "dividends", INTEREST: "interest" } as const;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Per calendar year with any income, oldest first. Without an NBP rate the broker's (`fxRate`) is used; with neither, the amount is left out. */
export function incomeByYear(transactions: TransactionItem[], fx: FxHistory): YearIncome[] {
  const years = new Map<number, YearIncome>();
  for (const t of transactions) {
    const kind = KIND[t.type as keyof typeof KIND];
    if (!kind) continue;
    const pln = toPlnD1(t.amount, t.currency || "PLN", t.date, fx, t.fxRate);
    if (Number.isNaN(pln)) continue;
    const year = Number(t.date.slice(0, 4));
    const y = years.get(year) ?? { year, coupons: 0, dividends: 0, interest: 0, total: 0 };
    y[kind] += pln;
    y.total += pln;
    years.set(year, y);
  }
  return [...years.values()]
    .sort((a, b) => a.year - b.year)
    .map((y) => ({ year: y.year, coupons: round2(y.coupons), dividends: round2(y.dividends), interest: round2(y.interest), total: round2(y.total) }));
}
