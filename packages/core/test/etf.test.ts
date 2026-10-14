import { describe, expect, it } from "vitest";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { listingFromTicker } from "../src/instruments/listing.ts";
import { adjustForSplits, splitFactorAfter, unadjustSplits } from "../src/prices/splits.ts";
import { convertSheetRows, type SheetRow } from "../src/transactions/fromSheet.ts";
import { parseTransactionFile } from "../src/transactions/schema.ts";
import { cashByAccount } from "../src/valuation/cash.ts";
import { positionKey, positionsAt } from "../src/valuation/positions.ts";
import { priceRows } from "../src/valuation/priceRows.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";

const SPXS = "IE00B3YCGJ38";
const SPLIT = [{ date: "2025-12-15", ratio: 100 }];

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: `TX#${t.date}#${t.id ?? "x"}`, GSI1PK: "TX", GSI1SK: `${t.date}#${t.id ?? "x"}`, id: t.id ?? "x", account: "a", currency: "PLN", source: "test", ...t }) as TransactionItem;

const etf: InstrumentItem = {
  PK: `INST#${SPXS}`, SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: SPXS, isin: SPXS, code: "SPXS", name: "Invesco S&P 500 UCITS ETF", type: "ETF",
  currency: "EUR", venue: "XAMS", sourceIds: { yahoo: "SPXS.AS" }, active: true, live: false, splits: SPLIT, updatedAt: "",
};
const price = (date: string, close: number): PriceItem => ({
  PK: `INST#${SPXS}`, SK: `PX#XAMS#${date}`, isin: SPXS, venue: "XAMS", date, open: null, high: null, low: null, close,
  volume: 0, trades: 0, turnover: 0, traded: true, currency: "EUR", source: "yahoo", fetchedAt: "", status: "final",
});

describe("splits", () => {
  // Yahoo's SPXS.AS around the 100:1 split: split-adjusted before it (traded at ~1159 EUR on 2025-12-12).
  const adjusted = [
    { date: "2025-12-11", close: 11.6375 },
    { date: "2025-12-12", close: 11.5891 },
    { date: "2025-12-15", close: 11.59 },
    { date: "2025-12-16", close: 11.5 },
  ];

  it("multiplies the ratios of the splits after a date", () => {
    expect(splitFactorAfter(SPLIT, "2025-12-12")).toBe(100);
    expect(splitFactorAfter(SPLIT, "2025-12-15")).toBe(1);
    expect(splitFactorAfter([...SPLIT, { date: "2026-06-01", ratio: 2 }], "2025-01-01")).toBe(200);
    expect(splitFactorAfter(undefined, "2025-01-01")).toBe(1);
  });

  it("converts a split-adjusted series back to traded prices", () => {
    const { closes, undone } = unadjustSplits(adjusted, SPLIT);
    expect(undone).toEqual(SPLIT);
    expect(closes.map((c) => c.close)).toEqual([1163.75, 1158.91, 11.59, 11.5]);
  });

  it("leaves a series alone that already shows the drop (not adjusted by the source)", () => {
    const traded = [
      { date: "2025-12-12", close: 1158.91 },
      { date: "2025-12-15", close: 11.59 },
    ];
    expect(unadjustSplits(traded, SPLIT)).toEqual({ closes: traded, undone: [] });
  });

  it("puts traded prices on today's share basis for charts", () => {
    expect(adjustForSplits([{ date: "2025-08-11", close: 1093.04 }, { date: "2026-01-02", close: 12 }], SPLIT).map((p) => p.close)).toEqual([10.9304, 12]);
  });
});

describe("listingFromTicker", () => {
  it("maps the sheet's tickers to our venue and the Yahoo symbol", () => {
    expect(listingFromTicker("AMS:VWRL")).toEqual({ code: "VWRL", venue: "XAMS", yahoo: "VWRL.AS" });
    expect(listingFromTicker("FRA:EXS1")).toEqual({ code: "EXS1", venue: "XETR", yahoo: "EXS1.DE" });
    expect(listingFromTicker("LON:CSPX")).toEqual({ code: "CSPX", venue: "XLON", yahoo: "CSPX.L" });
    expect(listingFromTicker("XYZ:ABC")).toBeUndefined();
    expect(listingFromTicker("IZ0836")).toBeUndefined();
  });
});

describe("ETF positions and valuation", () => {
  const txs = [
    tx({ id: "1", date: "2025-08-01", type: "DEPOSIT", amount: 10000 }),
    tx({ id: "2", date: "2025-08-11", type: "BUY", isin: SPXS, quantity: 2, price: 1093.04, fxRate: 4.2619, amount: -9316.86, fee: 20 }),
    tx({ id: "3", date: "2025-12-15", type: "SPLIT", isin: SPXS, ratio: 100, amount: 0 }),
    tx({ id: "4", date: "2026-01-20", type: "SELL", isin: SPXS, quantity: 50, price: 12, fxRate: 4.2, amount: 2515, fee: 5 }),
    tx({ id: "5", date: "2026-03-20", type: "DIVIDEND", isin: SPXS, amount: 12.34 }),
  ];

  it("a split multiplies the quantity and keeps the cost; dividends count as income", () => {
    expect(positionsAt(txs, "2025-12-14").get(positionKey("a", SPXS))).toMatchObject({ quantity: 2, cost: 9336.86 });
    expect(positionsAt(txs, "2025-12-15").get(positionKey("a", SPXS))).toMatchObject({ quantity: 200, cost: 9336.86 });
    expect(positionsAt(txs, "2026-12-31").get(positionKey("a", SPXS))).toMatchObject({ quantity: 150, cost: 7002.65, couponsReceived: 12.34 });
  });

  it("cash: the split moves no money, the dividend adds to it", () => {
    expect(cashByAccount(txs, "2026-12-31").get("a")?.get("PLN")).toBe(3190.48); // 10000 − 9316.86 − 20 + 2515 + 12.34
  });

  it("values an ETF in PLN at the NBP mid rate; cost stays as paid in PLN", () => {
    const snap = valuePortfolio({
      date: "2026-02-02", instruments: [etf], transactions: txs, prices: new Map([[SPXS, price("2026-01-30", 12.5)]]),
      referenceIndex: new Map(), couponPeriods: new Map(), fx: new Map([["EUR", { mid: 4.2, date: "2026-01-30" }]]),
    });
    expect(snap.holdings[0]).toMatchObject({ code: "SPXS", currency: "EUR", quantity: 150, cleanPrice: 12.5, valuePerUnit: 52.5, value: 7875, cost: 7002.65, gain: 872.35, fx: { rate: 4.2, date: "2026-01-30" }, flags: [] });
  });

  it("flags a missing exchange rate instead of valuing in the wrong currency", () => {
    const snap = valuePortfolio({ date: "2026-02-02", instruments: [etf], transactions: txs, prices: new Map([[SPXS, price("2026-01-30", 12.5)]]), referenceIndex: new Map(), couponPeriods: new Map() });
    expect(snap.holdings[0]).toMatchObject({ value: null, flags: ["no_fx"] });
  });

  it("the 1-year change in the Prices view compares on today's share basis across a split", () => {
    const [row] = priceRows([etf], new Map([[SPXS, price("2026-08-14", 13.5)]]), new Map([[SPXS, price("2025-08-14", 1100)]]), "2026-08-14");
    expect(row).toMatchObject({ price: 13.5, yearAgo: { date: "2025-08-14", price: 11 } });
    expect(row!.change1y).toBeCloseTo(13.5 / 11 - 1, 4);
  });
});

describe("convertSheetRows: ETFs", () => {
  const row = (r: Partial<SheetRow>): SheetRow => ({
    row: 2, account: "Broker Foreign", date: "2025-08-11", ticker: "AMS:SPXS", name: "Invesco S&P 500 UCITS ETF", currency: "EUR",
    assetClass: "Akcje zagraniczne", type: "Zakup", quantity: 3, price: 1093.04, fee: 40.53, fxRate: 4.261857, nominal: 1, totalPln: 14015.67, comment: "", ...r,
  });
  const etfs = new Map([["AMS:SPXS", { isin: SPXS }]]);

  it("converts buys (EUR price, PLN amount and fee, the broker's rate), sells, dividends and splits", () => {
    const out = convertSheetRows(
      [
        row({}),
        row({ date: "2025-09-23", type: "Sprzedaż", quantity: 2, price: 1129.34, fee: 30, fxRate: 4.263432, totalPln: 9599.8 }),
        row({ date: "2025-12-15", type: "Split", name: "AMS:SPXS", quantity: 0, price: 1, fee: 0, fxRate: 1, totalPln: 1, splitRatio: 100 }),
        row({ date: "2026-03-30", type: "Dywidenda / Odsetki", currency: "PLN", quantity: 1, price: 1, fee: 0, fxRate: 1, totalPln: 25.5 }),
        row({ ticker: "AMS:UNKNOWN", name: "Not in the ETF file" }),
      ],
      new Map(),
      new Map(),
      etfs,
    );
    expect(out.transactions.map((t) => [t.type, t.quantity ?? t.ratio, t.price, t.fxRate, t.amount, t.fee])).toEqual([
      ["BUY", 3, 1093.04, 4.261857, -13975.14, 40.53],
      ["SELL", 2, 1129.34, 4.263432, 9599.8, 30],
      ["SPLIT", 100, undefined, undefined, 0, undefined],
      ["DIVIDEND", undefined, undefined, undefined, 25.5, undefined],
    ]);
    expect(out.etfInstruments).toEqual([
      { isin: SPXS, code: "SPXS", name: "Invesco S&P 500 UCITS ETF", type: "ETF", currency: "EUR", venue: "XAMS", sourceIds: { yahoo: "SPXS.AS" }, active: true, live: false, splits: SPLIT },
    ]);
    expect(out.skipped.map((s) => s.ticker)).toEqual(["AMS:UNKNOWN"]);
    expect(out.accounts).toEqual([{ account: "Broker Foreign", incomplete: ["ETFs"] }]);
    expect(() => parseTransactionFile(JSON.stringify(out.transactions), "check")).not.toThrow();
  });
});
