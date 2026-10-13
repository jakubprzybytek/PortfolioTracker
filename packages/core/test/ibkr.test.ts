import { describe, expect, it } from "vitest";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { interpolatePricePath } from "../src/prices/pricePath.ts";
import { convertSheetRows, maturityFromName, type SheetRow } from "../src/transactions/fromSheet.ts";
import { parseTransactionFile } from "../src/transactions/schema.ts";
import { cashByAccount } from "../src/valuation/cash.ts";
import { positionKey, positionsAt } from "../src/valuation/positions.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";

const EUR = "ZZWALUTYEUR0";
const OAT = "FR0014003513";

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#IBKR", SK: "TX#", GSI1PK: "TX", GSI1SK: "", id: "x", account: "IBKR", currency: "PLN", source: "t", ...t }) as TransactionItem;
const inst = (i: Partial<InstrumentItem> & Pick<InstrumentItem, "isin" | "type" | "currency">): InstrumentItem =>
  ({ PK: `INST#${i.isin}`, SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: i.isin, code: i.isin, name: i.isin, venue: "CALC", sourceIds: {}, active: true, live: false, updatedAt: "", ...i }) as InstrumentItem;

describe("price path", () => {
  it("moves at a constant yield between known prices, one price per weekday", () => {
    const path = interpolatePricePath([
      { date: "2026-01-01", price: 96 },
      { date: "2027-01-01", price: 100 },
    ]);
    expect(path[0]).toEqual({ date: "2026-01-01", price: 96 });
    expect(path.at(-1)).toEqual({ date: "2027-01-01", price: 100 });
    expect(path.some((p) => p.date === "2026-01-03")).toBe(false); // a Saturday
    // half-way in time: the geometric mean, not the arithmetic one
    expect(path.find((p) => p.date === "2026-07-02")!.price).toBeCloseTo(96 * (100 / 96) ** (182 / 365), 3);
  });

  it("passes through every trade price", () => {
    const path = interpolatePricePath([
      { date: "2025-11-10", price: 95.26 },
      { date: "2026-10-02", price: 97.22 },
      { date: "2027-02-25", price: 100 },
    ]);
    expect(path.find((p) => p.date === "2026-10-02")!.price).toBe(97.22);
  });

  it("reads the maturity from IBKR's bond names", () => {
    expect(maturityFromName("DE Govt 0.0 Nov15'27")).toBe("2027-11-15");
    expect(maturityFromName("US-T Govt Bill Oct01'26")).toBe("2026-10-01");
    expect(maturityFromName("US9128205B99")).toBeUndefined();
  });
});

describe("IBKR positions and valuation", () => {
  // PLN in, EUR bought and spent on a bond the same day (sale listed first: same-day order must not clip it)
  const txs = [
    tx({ id: "1", date: "2025-10-02", type: "DEPOSIT", amount: 20000 }),
    tx({ id: "2", date: "2025-10-02", type: "SELL", isin: EUR, quantity: 4866, price: 1, fxRate: 4.26, amount: 20729.16 }),
    tx({ id: "3", date: "2025-10-02", type: "BUY", isin: EUR, quantity: 5000, price: 1, fxRate: 4.26, amount: -21300 }),
    tx({ id: "4", date: "2025-10-02", type: "BUY", isin: OAT, quantity: 5, price: 97.22, fxRate: 4.26, amount: -20707.86, fee: 21.3 }),
  ];

  it("buys before sales within a day; foreign cash is a position with its PLN cost", () => {
    const p = positionsAt(txs, "2025-12-31");
    expect(p.get(positionKey("IBKR", EUR))).toMatchObject({ quantity: 134, cost: 570.84 }); // 5000 − 4866 EUR, at 4.26
    expect(p.get(positionKey("IBKR", OAT))).toMatchObject({ quantity: 5, cost: 20729.16 });
    expect(cashByAccount(txs, "2025-12-31").get("IBKR")).toBe(-1300); // 20000 − 21300 + 20729.16 − 20729.16
  });

  it("values the currency at the NBP rate and the bond at its calculated price × nominal × rate", () => {
    const px: PriceItem = {
      PK: `INST#${OAT}`, SK: "PX#CALC#2026-10-12", isin: OAT, venue: "CALC", date: "2026-10-12", open: null, high: null, low: null, close: 98.5,
      volume: 0, trades: 0, turnover: 0, traded: true, currency: "EUR", source: "calculated", fetchedAt: "", status: "final",
    };
    const snap = valuePortfolio({
      date: "2026-10-12",
      instruments: [inst({ isin: EUR, type: "CURRENCY", currency: "EUR", venue: "FX" }), inst({ isin: OAT, type: "BOND_IBKR", currency: "EUR", nominal: 1000 })],
      transactions: txs,
      prices: new Map([[OAT, px]]),
      referenceIndex: new Map(),
      couponRates: new Map(),
      fx: new Map([["EUR", { mid: 4.3, date: "2026-10-12" }]]),
    });
    const by = Object.fromEntries(snap.holdings.map((h) => [h.isin, h]));
    expect(by[EUR]).toMatchObject({ type: "CURRENCY", quantity: 134, valuePerUnit: 4.3, value: 576.2, flags: [] });
    expect(by[OAT]).toMatchObject({ nominal: 1000, valuePerUnit: 4235.5, value: 21177.5, flags: [] }); // 98.5 % × 1000 × 4.3
  });
});

describe("convertSheetRows: IBKR", () => {
  const row = (r: Partial<SheetRow>): SheetRow => ({
    row: 2, account: "IBKR", date: "2025-10-02", ticker: "Waluty_EUR", name: "Waluty_EUR", currency: "EUR", assetClass: "Waluty",
    type: "Zakup", quantity: 10441, price: 1, fee: 0, fxRate: 4.25895, nominal: 1, totalPln: 44467.7, comment: "", ...r,
  });

  it("converts currency rows into a currency position and bond rows into a bond with a price path to maturity", () => {
    const out = convertSheetRows(
      [
        row({}),
        row({ ticker: OAT, name: "FR Govt 0.0 Feb25'27", assetClass: "Obligacje skarbowe zagraniczne", quantity: 5, price: 972.2, fee: 21.3, fxRate: 4.26, totalPln: 20729.16 }),
        row({ type: "Sprzedaż", quantity: 4866, fxRate: 4.26, totalPln: 20729.16 }),
      ],
      new Map(),
    );
    expect(out.transactions.map((t) => [t.type, t.isin, t.quantity, t.price, t.fxRate, t.amount, t.fee])).toEqual([
      ["BUY", EUR, 10441, 1, 4.25895, -44467.7, 0],
      ["BUY", OAT, 5, 97.22, 4.26, -20707.86, 21.3],
      ["SELL", EUR, 4866, 1, 4.26, 20729.16, 0],
    ]);
    expect(out.ibkrInstruments).toEqual([
      {
        isin: OAT, code: OAT, name: "FR Govt 0.0 Feb25'27", type: "BOND_IBKR", currency: "EUR", venue: "CALC", sourceIds: {}, active: true, live: false, nominal: 1000,
        pricePath: [{ date: "2025-10-02", price: 97.22 }, { date: "2027-02-25", price: 100 }],
      },
      { isin: EUR, code: "EUR", name: "EUR cash", type: "CURRENCY", currency: "EUR", venue: "FX", sourceIds: {}, active: true, live: false },
    ]);
    expect(out.skipped).toEqual([]);
    expect(() => parseTransactionFile(JSON.stringify(out.transactions), "check")).not.toThrow();
  });
});
