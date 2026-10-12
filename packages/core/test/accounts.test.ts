import { describe, expect, it } from "vitest";
import type { HoldingSnapshot, TransactionItem } from "../src/db/items.ts";
import { accountSummaries, xirr } from "../src/valuation/accounts.ts";

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: "TX#", GSI1PK: "TX", GSI1SK: "", id: `${t.date}${t.type}${t.amount}`, account: "a", currency: "PLN", source: "t", ...t }) as TransactionItem;

describe("xirr", () => {
  it("is the annual rate that discounts the flows to zero", () => {
    // 1000 in, 1100 out a year later: 10 %
    expect(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 1100 }])).toBeCloseTo(0.1, 5);
    // two deposits, the second 182 days in: −1000 − 1000 × 1.2029^(−182/365) + 2300 / 1.2029 ≈ 0
    expect(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2025-07-02", amount: -1000 }, { date: "2026-01-01", amount: 2300 }])!).toBeCloseTo(0.2029, 4);
    expect(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2026-01-01", amount: 900 }])).toBeCloseTo(-0.1, 5);
  });

  it("is null without flows of both signs", () => {
    expect(xirr([{ date: "2025-01-01", amount: -1000 }])).toBeNull();
    expect(xirr([])).toBeNull();
  });
});

describe("accountSummaries", () => {
  const holding = (account: string, value: number, type: HoldingSnapshot["type"] = "BOND_LISTED") => ({ account, value, type }) as HoldingSnapshot;
  const txs = [
    tx({ date: "2025-01-01", type: "DEPOSIT", amount: 10000 }),
    tx({ date: "2025-01-02", type: "BUY", isin: "X", quantity: 10, amount: -9000, fee: 20 }),
    tx({ date: "2025-06-01", type: "COUPON", isin: "X", amount: 300 }),
    tx({ date: "2025-07-01", type: "FEE", amount: -15 }),
    tx({ date: "2025-08-01", type: "WITHDRAWAL", amount: -500 }),
    tx({ date: "2025-03-01", account: "b", type: "DEPOSIT", amount: 2000 }),
  ];
  const snap = { date: "2026-01-01", holdings: [holding("a", 9500)], accounts: { a: { cash: 765 }, b: { cash: 2000, incomplete: ["ETFs"] } } };

  it("per account: net deposits, value, cash, profit, income, costs and XIRR", () => {
    const { accounts } = accountSummaries(snap, txs);
    expect(accounts[0]).toMatchObject({ account: "a", netDeposits: 9500, positions: 9500, cash: 765, total: 10265, profit: 765, income: 300, costs: 35, firstDate: "2025-01-01" });
    expect(accounts[0]!.xirr!).toBeGreaterThan(0.07);
    expect(accounts[0]!.xirr!).toBeLessThan(0.09);
    expect(accounts[1]).toMatchObject({ account: "b", incomplete: ["ETFs"], netDeposits: 2000, total: 2000, profit: 0 });
  });

  it("the total covers only fully tracked accounts", () => {
    const { total } = accountSummaries(snap, txs);
    expect(total).toMatchObject({ account: "Total", netDeposits: 9500, total: 10265, profit: 765 });
    expect(total.xirr).toBeCloseTo(accountSummaries(snap, txs).accounts[0]!.xirr!, 6);
  });
});
