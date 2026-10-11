import { describe, expect, it } from "vitest";
import { convertSheetRows, type SheetRow } from "../src/transactions/fromSheet.ts";
import { parseTransactionFile } from "../src/transactions/schema.ts";

const row = (r: Partial<SheetRow>): SheetRow => ({
  row: 2, account: "Bossa", date: "2025-03-20", ticker: "Gotówka", currency: "PLN", assetClass: "Gotówka", type: "Wpłata środków",
  quantity: 1, price: 1, fee: 0, nominal: 1, totalPln: 0, comment: "", ...r,
});
const instruments = new Map([["IZ0836", { isin: "PL0000117024" }]]);

describe("convertSheetRows", () => {
  it("converts cash movements with signed amounts", () => {
    const { transactions } = convertSheetRows(
      [
        row({ type: "Wpłata środków", totalPln: 1000 }),
        row({ type: "Wypłata środków", totalPln: 200 }),
        row({ type: "Dywidenda / Odsetki", totalPln: 12.5, comment: "savings" }),
        row({ type: "Koszty", totalPln: 9.99 }),
      ],
      instruments,
    );
    expect(transactions.map((t) => [t.type, t.amount])).toEqual([["DEPOSIT", 1000], ["WITHDRAWAL", -200], ["INTEREST", 12.5], ["FEE", -9.99]]);
    expect(transactions[2]).toMatchObject({ note: "savings" });
    expect(transactions.every((t) => t.isin === undefined)).toBe(true);
  });

  it("converts bond buys, sells and coupons: price per bond → % of nominal, fee taken out of the buy total", () => {
    const { transactions } = convertSheetRows(
      [
        row({ ticker: "IZ0836", assetClass: "Obligacje skarbowe polskie", type: "Zakup", quantity: 6, price: 952.27, fee: 10.86, nominal: 1074.12, totalPln: 5724.48 }),
        row({ ticker: "IZ0836", assetClass: "Obligacje skarbowe polskie", type: "Sprzedaż", quantity: 2, price: 990, fee: 3.6, nominal: 1074.12, totalPln: 1976.4 }),
        row({ ticker: "IZ0836", assetClass: "Obligacje skarbowe polskie", type: "Dywidenda / Odsetki", totalPln: 214.2 }),
      ],
      instruments,
    );
    expect(transactions[0]).toMatchObject({ type: "BUY", isin: "PL0000117024", quantity: 6, price: 88.6558, amount: -5713.62, fee: 10.86 });
    expect(transactions[1]).toMatchObject({ type: "SELL", quantity: 2, price: 92.1685, amount: 1976.4, fee: 3.6 });
    expect(transactions[2]).toMatchObject({ type: "COUPON", isin: "PL0000117024", amount: 214.2 });
  });

  it("skips what the app can't value yet, with a reason", () => {
    const { transactions, skipped } = convertSheetRows(
      [
        row({ row: 5, ticker: "EDO-110332", assetClass: "Obligacje skarbowe polskie", type: "Zakup" }),
        row({ row: 6, ticker: "AMS:VWRL", assetClass: "Akcje zagraniczne", currency: "EUR", type: "Zakup" }),
        row({ row: 7, ticker: "Waluty_EUR", assetClass: "Waluty", currency: "EUR", type: "Zakup" }),
        row({ row: 8, ticker: "IZ0836", assetClass: "Obligacje skarbowe polskie", type: "Split" }),
      ],
      instruments,
    );
    expect(transactions).toHaveLength(0);
    expect(skipped.map((s) => [s.row, s.reason])).toEqual([
      [5, "retail bond: no ISIN; calculator not wired in yet"],
      [6, "ETF/share: phase 2 (prices, dividends, splits, FX)"],
      [7, "currency position: not modelled (foreign cash comes from cash balances later)"],
      [8, 'IZ0836: unsupported type "Split"'],
    ]);
  });

  it("gives identical rows distinct, stable ids", () => {
    const rows = [row({ totalPln: 500 }), row({ totalPln: 500 }), row({ totalPln: 300 })];
    const a = convertSheetRows(rows, instruments).transactions.map((t) => t.id);
    const b = convertSheetRows(rows, instruments).transactions.map((t) => t.id);
    expect(new Set(a).size).toBe(3);
    expect(a[1]).toBe(`${a[0]}-2`);
    expect(a).toEqual(b);
    // the import keeps the ids
    expect(parseTransactionFile(JSON.stringify(convertSheetRows(rows, instruments).transactions), "t").map((t) => t.id)).toEqual(a);
  });
});
