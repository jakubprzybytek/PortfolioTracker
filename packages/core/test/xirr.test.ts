import { describe, expect, it } from "vitest";
import type { TransactionItem } from "../src/db/items.ts";
import type { FxHistory } from "../src/valuation/fx.ts";
import { positionFlows, positionsXirr, xirr } from "../src/valuation/xirr.ts";

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: "TX#", GSI1PK: "TX", GSI1SK: "", id: `${t.date}${t.type}${t.amount}`, account: "a", currency: "PLN", source: "t", ...t }) as TransactionItem;

describe("positionFlows", () => {
  const fx: FxHistory = new Map([["EUR", [{ date: "2025-02-28", mid: 4.2 }, { date: "2025-09-30", mid: 4.3 }]]]);
  const txs = [
    tx({ date: "2025-01-02", type: "DEPOSIT", amount: 10000 }),
    tx({ date: "2025-01-02", type: "BUY", isin: "X", quantity: 10, amount: -9000, fee: 20 }),
    tx({ date: "2025-06-01", type: "COUPON", isin: "X", amount: 300 }),
    tx({ date: "2025-06-01", type: "TAX", isin: "X", amount: -57 }),
    tx({ date: "2025-07-01", type: "FEE", amount: -15 }),
    tx({ date: "2025-09-01", type: "SELL", isin: "X", quantity: 4, amount: 3700 }),
    tx({ date: "2025-03-03", account: "b", type: "BUY", isin: "X", quantity: 1, amount: -900 }),
    tx({ date: "2025-03-03", account: "b", type: "BUY", isin: "E", quantity: 5, amount: -500, fee: 1, currency: "EUR" }),
    tx({ date: "2025-10-01", account: "b", type: "DIVIDEND", isin: "E", amount: 10, currency: "EUR" }),
    tx({ date: "2025-04-01", account: "b", type: "BUY", isin: "W", quantity: 2, amount: -200 }),
    tx({ date: "2025-11-30", account: "b", type: "WRITE_OFF", isin: "W", quantity: 2, amount: 0 }),
    tx({ date: "2026-02-01", type: "COUPON", isin: "X", amount: 200 }),
  ];

  it("per position: buys with their fee out, sales, coupons and taxes on it in, a write-off as 0, one flow a day, PLN at NBP D-1, up to the date", () => {
    expect(positionFlows(txs, "2026-01-01", fx)).toEqual({
      "a|X": [["2025-01-02", -9020], ["2025-06-01", 243], ["2025-09-01", 3700]],
      "b|X": [["2025-03-03", -900]],
      "b|E": [["2025-03-03", -2104.2], ["2025-10-01", 43]],
      "b|W": [["2025-04-01", -200], ["2025-11-30", 0]],
    });
  });
});

describe("positionsXirr", () => {
  it("one position: its flows and its value at the end", () => {
    // 1000 in, worth 1100 a year later: 10 %
    expect(positionsXirr([[["2025-01-01", -1000]]], 1100, "2026-01-01")).toBeCloseTo(0.1, 5);
  });

  it("a group: all its positions' flows together with the sum of their values", () => {
    const a: [string, number][] = [["2025-01-01", -1000]];
    const b: [string, number][] = [["2025-07-02", -1000]];
    const both = positionsXirr([a, b], 2300, "2026-01-01");
    expect(both).toBeCloseTo(xirr([{ date: "2025-01-01", amount: -1000 }, { date: "2025-07-02", amount: -1000 }, { date: "2026-01-01", amount: 2300 }])!, 6);
  });

  it("closed (value 0): the flows alone, ending at the last; written off: −100 %", () => {
    expect(positionsXirr([[["2025-01-01", -1000], ["2026-01-01", 1050]]], 0, "2026-10-20")).toBeCloseTo(0.05, 5);
    expect(positionsXirr([[["2025-01-01", -1000], ["2026-05-31", 0]]], 0, "2026-10-20")).toBe(-1);
  });

  it("nothing for less than 30 days held, no flows or a value missing", () => {
    expect(positionsXirr([[["2026-10-01", -1000]]], 1010, "2026-10-20")).toBeNull();
    expect(positionsXirr([[["2025-01-01", -1000], ["2025-01-20", 1010]]], 0, "2026-10-20")).toBeNull();
    expect(positionsXirr([], 1000, "2026-10-20")).toBeNull();
    expect(positionsXirr([[["2025-01-01", -1000]]], NaN, "2026-10-20")).toBeNull();
  });
});
