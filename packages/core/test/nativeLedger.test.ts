import { describe, expect, it } from "vitest";
import { nativeLedger } from "../src/transactions/nativeLedger.ts";
import type { TransactionInput } from "../src/transactions/schema.ts";

// Made-up rows in the reference sheet's style: everything in PLN, foreign cash as positions bought and sold with PLN.
const EUR = "ZZWALUTYEUR0";
const USD = "ZZWALUTYUSD0";
const ccy = new Map([
  [EUR, "EUR"],
  [USD, "USD"],
]);
const t = (r: Partial<TransactionInput> & Pick<TransactionInput, "date" | "type" | "amount">): TransactionInput => ({ account: "IBKR", currency: "PLN", ...r });

describe("nativeLedger", () => {
  it("PLN converted at the broker becomes an exchange; a bond paid with that EUR becomes a EUR trade, its fee in EUR", () => {
    const rows = [
      t({ date: "2025-03-03", type: "DEPOSIT", amount: 10000 }),
      t({ date: "2025-03-03", type: "BUY", isin: EUR, quantity: 2300, price: 1, fxRate: 4.3, amount: -9890, fee: 0 }),
      // 2 bonds at 96.5 % of 1000 EUR = 1930 EUR, fee 4.30 PLN (1 EUR); the sheet sells the 1931 EUR that paid
      t({ date: "2025-03-04", type: "BUY", isin: "DE0001102523", quantity: 2, price: 96.5, fxRate: 4.3, amount: -8299, fee: 4.3 }),
      t({ date: "2025-03-04", type: "SELL", isin: EUR, quantity: 1931, price: 1, fxRate: 4.3, amount: 8303.3 }),
      // a fee paid in EUR: the sheet's PLN fee and a sale of 2 EUR for the same PLN
      t({ date: "2025-03-05", type: "FEE", amount: -8.6 }),
      t({ date: "2025-03-05", type: "SELL", isin: EUR, quantity: 2, price: 1, fxRate: 4.3, amount: 8.6 }),
    ];
    expect(nativeLedger(rows, ccy)).toEqual([
      { account: "IBKR", currency: "PLN", date: "2025-03-03", type: "DEPOSIT", amount: 10000 },
      { account: "IBKR", date: "2025-03-03", type: "EXCHANGE", amount: -9890, currency: "PLN", toAmount: 2300, toCurrency: "EUR" },
      { account: "IBKR", currency: "EUR", date: "2025-03-04", type: "BUY", isin: "DE0001102523", quantity: 2, price: 96.5, amount: -1930, fee: 1 },
      { account: "IBKR", currency: "EUR", date: "2025-03-05", type: "FEE", amount: -2 },
    ]);
  });

  it("EUR sold and USD bought for the same PLN is one exchange; a redemption paid out in USD is a USD sale", () => {
    const rows = [
      t({ date: "2025-04-01", type: "SELL", isin: EUR, quantity: 100, price: 1, fxRate: 4.3, amount: 430 }),
      t({ date: "2025-04-01", type: "BUY", isin: USD, quantity: 110.5, price: 1, fxRate: 3.8914, amount: -430 }),
      t({ date: "2025-10-01", type: "SELL", isin: "US9128205B99", quantity: 5, price: 100, fxRate: 3.8, amount: 19000 }),
      t({ date: "2025-10-01", type: "BUY", isin: USD, quantity: 5000, price: 1, fxRate: 3.8, amount: -19000, note: "Transakcja dodana automatycznie" }),
    ];
    expect(nativeLedger(rows, ccy)).toEqual([
      { account: "IBKR", date: "2025-04-01", type: "EXCHANGE", amount: -100, currency: "EUR", toAmount: 110.5, toCurrency: "USD" },
      { account: "IBKR", currency: "USD", date: "2025-10-01", type: "SELL", isin: "US9128205B99", quantity: 5, price: 100, amount: 5000 },
    ]);
  });

  it("currency sold for PLN is an exchange to PLN; a trade with nothing to pair keeps its PLN booking", () => {
    const rows = [
      t({ date: "2025-05-01", type: "SELL", isin: USD, quantity: 50, price: 1, fxRate: 3.7, amount: 185 }),
      t({ date: "2025-05-02", type: "BUY", isin: "DE0001102523", quantity: 1, price: 97, fxRate: 4.25, amount: -4122.5 }),
    ];
    expect(nativeLedger(rows, ccy)).toEqual([
      { account: "IBKR", date: "2025-05-01", type: "EXCHANGE", amount: -50, currency: "USD", toAmount: 185, toCurrency: "PLN" },
      { account: "IBKR", currency: "PLN", date: "2025-05-02", type: "BUY", isin: "DE0001102523", quantity: 1, price: 97, fxRate: 4.25, amount: -4122.5 },
    ]);
  });
});
