import { describe, expect, it } from "vitest";
import type { TransactionItem } from "../src/db/items.ts";
import { incomeByYear } from "../src/valuation/income.ts";

const tx = (date: string, type: string, amount: number, currency = "PLN", fxRate?: number) => ({ date, type, amount, currency, ...(fxRate ? { fxRate } : {}) }) as unknown as TransactionItem;

describe("incomeByYear", () => {
  it("sums coupons, dividends and interest per year in PLN at NBP D-1; other types don't count", () => {
    const fx = new Map([["EUR", [{ date: "2025-03-03", mid: 4.2 }]]]);
    const r = incomeByYear(
      [
        tx("2025-01-10", "COUPON", 100),
        tx("2025-03-04", "DIVIDEND", 10, "EUR"), // 4.2 (the day before)
        tx("2025-06-30", "INTEREST", 1.5),
        tx("2025-07-01", "BUY", -1000),
        tx("2026-02-01", "COUPON", 50.555),
        tx("2026-02-02", "DIVIDEND", 1, "USD", 3.9), // no NBP rate: the broker's
      ],
      fx,
    );
    expect(r).toEqual([
      { year: 2025, coupons: 100, dividends: 42, interest: 1.5, total: 143.5 },
      { year: 2026, coupons: 50.56, dividends: 3.9, interest: 0, total: 54.46 },
    ]);
  });
});
