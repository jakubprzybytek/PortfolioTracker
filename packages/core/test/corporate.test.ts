import { describe, expect, it } from "vitest";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { convertSheetRows, type SheetRow } from "../src/transactions/fromSheet.ts";
import { parseTransactionFile } from "../src/transactions/schema.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";

const KRU = "PLKRK0000713";

describe("corporate bonds", () => {
  const inst: InstrumentItem = {
    PK: `INST#${KRU}`, SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: KRU, isin: KRU, code: "KRU0827", name: "Kruk S.A.", type: "BOND_CORPORATE",
    currency: "PLN", venue: "CATALYST", sourceIds: { biznesradar: "KRU0827" }, active: true, live: false, nominal: 100, updatedAt: "",
  };
  const price: PriceItem = {
    PK: `INST#${KRU}`, SK: "PX#CATALYST#2026-10-09", isin: KRU, venue: "CATALYST", date: "2026-10-09", open: null, high: null, low: null, close: 100.45,
    volume: 520, trades: 0, turnover: 0, traded: true, currency: "PLN", source: "biznesradar", fetchedAt: "", status: "final",
  };
  const buy = { PK: "ACCT#a", SK: "TX#2026-03-03#1", GSI1PK: "TX", GSI1SK: "2026-03-03#1", id: "1", account: "a", date: "2026-03-03", type: "BUY", isin: KRU, quantity: 40, price: 101.2, amount: -4048, fee: 8.1, currency: "PLN", source: "t" } as TransactionItem;

  it("values at clean price (% of nominal) × nominal, without accrued interest", () => {
    const snap = valuePortfolio({ date: "2026-10-12", instruments: [inst], transactions: [buy], prices: new Map([[KRU, price]]), referenceIndex: new Map(), couponRates: new Map() });
    expect(snap.holdings[0]).toMatchObject({ type: "BOND_CORPORATE", quantity: 40, cleanPrice: 100.45, nominal: 100, accruedInterest: null, valuePerUnit: 100.45, value: 4018, cost: 4056.1, flags: [] });
  });

  it("converts the sheet's Catalyst rows; a bond no longer held gets its trade prices as manual prices", () => {
    const row = (r: Partial<SheetRow>): SheetRow => ({
      row: 2, account: "Broker Bonds", date: "2026-03-03", ticker: "KRU0827", name: "KRU0827", currency: "PLN", assetClass: "Obligacje korporacyjne polskie",
      type: "Zakup", quantity: 40, price: 101.2, fee: 8.1, fxRate: 1, nominal: 100, totalPln: 4056.1, comment: "", ...r,
    });
    const corporates = new Map([
      ["KRU0827", { isin: KRU, nominal: 100, name: "Kruk S.A. (WIBOR 3M + 3.3%)" }],
      ["TPE1025", { isin: "PLO144500017", nominal: 1000, name: "Tauron Polska Energia S.A. (WIBOR 6M + 1.35%)" }],
    ]);
    const out = convertSheetRows(
      [
        row({}),
        row({ date: "2026-05-12", type: "Dywidenda / Odsetki", quantity: 1, price: 1, fee: 0, totalPln: 70, comment: "Pobrany podatek: 16.42 PLN" }),
        row({ ticker: "TPE1025", date: "2022-10-26", quantity: 5, price: 985, fee: 9.85, nominal: 1000, totalPln: 4934.85 }),
        row({ ticker: "TPE1025", date: "2025-10-30", type: "Sprzedaż", quantity: 5, price: 1000, fee: 0, nominal: 1000, totalPln: 5000 }),
        row({ ticker: "XYZ0130", name: "not in the file" }),
      ],
      new Map(),
      new Map(),
      new Map(),
      corporates,
    );
    expect(out.transactions.map((t) => [t.type, t.isin, t.quantity, t.price, t.amount, t.fee])).toEqual([
      ["BUY", KRU, 40, 101.2, -4048, 8.1],
      ["COUPON", KRU, undefined, undefined, 70, undefined],
      ["BUY", "PLO144500017", 5, 98.5, -4925, 9.85],
      ["SELL", "PLO144500017", 5, 100, 5000, 0],
    ]);
    expect(out.corporateInstruments).toEqual([
      { isin: KRU, code: "KRU0827", name: "Kruk S.A. (WIBOR 3M + 3.3%)", type: "BOND_CORPORATE", currency: "PLN", venue: "CATALYST", sourceIds: { biznesradar: "KRU0827" }, active: true, live: false, nominal: 100 },
      { isin: "PLO144500017", code: "TPE1025", name: "Tauron Polska Energia S.A. (WIBOR 6M + 1.35%)", type: "BOND_CORPORATE", currency: "PLN", venue: "MANUAL", sourceIds: {}, active: false, live: false, nominal: 1000 },
    ]);
    expect(out.manualPrices).toEqual([
      { isin: "PLO144500017", date: "2022-10-26", price: 98.5, currency: "PLN", note: "trade price" },
      { isin: "PLO144500017", date: "2025-10-30", price: 100, currency: "PLN", note: "trade price" },
    ]);
    expect(out.skipped.map((s) => [s.ticker, s.what])).toEqual([["XYZ0130", "Catalyst bonds"]]);
    expect(() => parseTransactionFile(JSON.stringify(out.transactions), "check")).not.toThrow();
  });
});
