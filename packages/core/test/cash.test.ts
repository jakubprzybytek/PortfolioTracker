import { describe, expect, it } from "vitest";
import type { TransactionItem } from "../src/db/items.ts";
import { parseManualPrices, privateAssetId } from "../src/prices/manual.ts";
import { cashByAccount } from "../src/valuation/cash.ts";

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: "TX#x", GSI1PK: "TX", GSI1SK: "x", id: "x", account: "a", currency: "PLN", source: "t", ...t }) as TransactionItem;

describe("cashByAccount", () => {
  it("adds every cash movement per account; buys also pay their fee", () => {
    const txs = [
      tx({ date: "2025-01-02", type: "DEPOSIT", amount: 10000 }),
      tx({ date: "2025-01-03", type: "BUY", isin: "PL0000113783", quantity: 10, amount: -8000, fee: 16 }),
      tx({ date: "2025-04-25", type: "COUPON", isin: "PL0000113783", amount: 175 }),
      tx({ date: "2025-05-01", type: "SELL", isin: "PL0000113783", quantity: 5, amount: 4100, fee: 8 }), // received, net of the fee
      tx({ date: "2025-05-02", type: "FEE", amount: -9.99 }),
      tx({ date: "2025-06-01", type: "WITHDRAWAL", amount: -1000 }),
      tx({ date: "2025-01-05", account: "b", type: "DEPOSIT", amount: 500 }),
      tx({ date: "2025-01-06", account: "b", type: "INTEREST", amount: 1.25 }),
    ];
    const plain = (m: Map<string, Map<string, number>>) => Object.fromEntries([...m].map(([a, c]) => [a, Object.fromEntries(c)]));
    expect(plain(cashByAccount(txs, "2025-12-31"))).toEqual({ a: { PLN: 5249.01 }, b: { PLN: 501.25 } });
    expect(plain(cashByAccount(txs, "2025-01-03"))).toEqual({ a: { PLN: 1984 } });
  });

  it("keeps each currency apart: trades and fees in the currency paid, an exchange moves money between two", () => {
    const txs = [
      tx({ date: "2026-01-02", type: "DEPOSIT", amount: 10000 }),
      tx({ date: "2026-01-03", type: "EXCHANGE", amount: -8600, fee: 4, toAmount: 2000, toCurrency: "EUR" }),
      tx({ date: "2026-01-04", type: "BUY", isin: "DE0001102523", quantity: 1, amount: -965, fee: 1.25, currency: "EUR" }),
      tx({ date: "2026-01-05", type: "EXCHANGE", amount: -300, fee: 1, currency: "EUR", toAmount: 345.5, toCurrency: "USD" }),
      tx({ date: "2026-01-06", type: "DEPOSIT", amount: 100, currency: "USD" }),
    ];
    const ibkr = cashByAccount(txs, "2026-12-31").get("a")!;
    expect(Object.fromEntries(ibkr)).toEqual({ PLN: 1396, EUR: 732.75, USD: 445.5 });
  });
});

describe("manual prices", () => {
  it("become MANUAL price items; assets without an ISIN get a private ZZ id", () => {
    const [p] = parseManualPrices(JSON.stringify([{ isin: "ZZRZESZOW000", date: "2026-10-11", price: 1000 }]), "test");
    expect(p).toMatchObject({ PK: "INST#ZZRZESZOW000", SK: "PX#MANUAL#2026-10-11", venue: "MANUAL", close: 1000, currency: "PLN", status: "final" });
    expect(privateAssetId("Rzeszów")).toBe("ZZRZESZOW000");
    expect(privateAssetId("Złota 44 apartment")).toBe("ZZZLOTA44AP0");
    expect(() => parseManualPrices(JSON.stringify([{ isin: "x", date: "2026-10-11", price: 1 }]), "t")).toThrow();
  });
});

import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";
import { toReferenceIndex } from "../src/bonds/izIndex.ts";

describe("cash in the snapshot", () => {
  it("records cash per account and leaves incomplete accounts out of the total", () => {
    const txs = [
      tx({ date: "2025-01-02", type: "DEPOSIT", amount: 1000 }),
      tx({ date: "2025-01-02", account: "etf", type: "DEPOSIT", amount: 50000 }), // its ETF buys aren't imported
    ];
    const snap = valuePortfolio({ date: "2025-02-01", instruments: [], transactions: txs, prices: new Map(), referenceIndex: toReferenceIndex([]), couponRates: new Map(), accounts: [{ account: "etf", incomplete: ["ETFs"] }] });
    expect(snap.accounts).toEqual({ a: { cash: 1000 }, etf: { cash: 50000, incomplete: ["ETFs"] } });
    expect(snap.totals.cash).toBe(1000);
  });
});
