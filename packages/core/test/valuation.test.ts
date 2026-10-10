import { beforeAll, describe, expect, it } from "vitest";
import { parseMfCalculator } from "../src/mf/calculator.ts";
import { toReferenceIndex, type ReferenceIndex } from "../src/bonds/izIndex.ts";
import type { BondTerms } from "../src/bonds/terms.ts";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { positionsAt } from "../src/valuation/positions.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";
import { parseTransactionFile, transactionId } from "../src/transactions/schema.ts";
import { gpwRowsToPriceItems } from "../src/gpw/toPriceItems.ts";
import { parseGpwHistoryXls } from "../src/gpw/parseHistory.ts";
import { FIXTURES, fixture } from "./fixtures.ts";

let index: ReferenceIndex;
let iz: BondTerms;
let ds: BondTerms;

beforeAll(() => {
  const data = parseMfCalculator(fixture(FIXTURES.mfCalculator));
  index = toReferenceIndex(data.referenceIndex);
  iz = data.bonds.find((b) => b.code === "IZ0836")!;
  ds = data.bonds.find((b) => b.code === "DS0432")!;
});

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: `TX#${t.date}#${t.id ?? "x"}`, GSI1PK: "TX", GSI1SK: `${t.date}#${t.id ?? "x"}`, id: "x", account: "a", currency: "PLN", source: "test", ...t }) as TransactionItem;

describe("positionsAt", () => {
  it("accumulates buys at average cost, reduces on sells, tracks coupons", () => {
    const txs = [
      tx({ id: "1", date: "2025-01-10", type: "BUY", isin: "PL0000113783", quantity: 10, price: 80, amount: -8000, fee: 10 }),
      tx({ id: "2", date: "2025-03-10", type: "BUY", isin: "PL0000113783", quantity: 10, price: 82, amount: -8200, fee: 10 }),
      tx({ id: "3", date: "2025-04-27", type: "COUPON", isin: "PL0000113783", amount: 350 }),
      tx({ id: "4", date: "2025-06-01", type: "SELL", isin: "PL0000113783", quantity: 5, price: 83, amount: 4150, fee: 5 }),
      tx({ id: "5", date: "2025-06-02", type: "DEPOSIT", amount: 1000 }),
    ];
    const p = positionsAt(txs, "2025-12-31").get("PL0000113783")!;
    expect(p.quantity).toBe(15);
    expect(p.cost).toBe(12165); // 16220 × 15/20
    expect(p.couponsReceived).toBe(350);
    expect(positionsAt(txs, "2025-02-01").get("PL0000113783")!.quantity).toBe(10);
    expect(positionsAt(txs, "2024-12-31").size).toBe(0);
  });
});

describe("valuePortfolio", () => {
  it("values listed bonds at clean price × nominal + accrued, incl. IZ indexation", () => {
    const instruments: InstrumentItem[] = [
      { PK: "INST#PL0000117024", SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: "PL0000117024", isin: "PL0000117024", code: "IZ0836", name: "IZ0836", type: "BOND_LISTED", currency: "PLN", venue: "XWAR", sourceIds: { gpw: "IZ0836" }, active: true, live: false, terms: iz, updatedAt: "" },
      { PK: "INST#PL0000113783", SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: "PL0000113783", isin: "PL0000113783", code: "DS0432", name: "DS0432", type: "BOND_LISTED", currency: "PLN", venue: "XWAR", sourceIds: { gpw: "DS0432" }, active: true, live: false, terms: ds, updatedAt: "" },
    ];
    const dayRows = parseGpwHistoryXls(fixture(FIXTURES.day20261009));
    const prices = new Map(gpwRowsToPriceItems(dayRows, "final").map((p) => [p.isin, p]));
    const transactions = [
      tx({ id: "1", date: "2026-01-15", type: "BUY", isin: "PL0000117024", quantity: 10, price: 90, amount: -9500, fee: 5 }),
      tx({ id: "2", date: "2026-01-15", type: "BUY", isin: "PL0000113783", quantity: 20, price: 80, amount: -16000, fee: 5 }),
    ];
    const snap = valuePortfolio({ date: "2026-10-09", instruments, transactions, prices, referenceIndex: index, couponRates: new Map() });

    const izH = snap.holdings.find((h) => h.code === "IZ0836")!;
    expect(izH).toMatchObject({ quantity: 10, cleanPrice: 87.92, nominal: 1105.53, accruedInterest: 2.73, valuePerUnit: 974.71, value: 9747.1, cost: 9505, flags: [] });
    expect(izH.gain).toBe(242.1);

    const dsH = snap.holdings.find((h) => h.code === "DS0432")!;
    // 2026-04-25 → 2026-10-09 = 167 days of 365 × 17.50 = 8.01
    expect(dsH).toMatchObject({ cleanPrice: 81.09, nominal: 1000, accruedInterest: 8.01, valuePerUnit: 818.91, value: 16378.2 });

    expect(snap.totals.value).toBe(26125.3);
    expect(snap.totals.cost).toBe(25510);
    expect(snap.byType["BOND_LISTED"]!.value).toBe(26125.3);
  });

  it("flags missing and stale prices and unknown instruments", () => {
    const stale: PriceItem = { PK: "INST#PL0000113783", SK: "PX#XWAR#2026-09-01", isin: "PL0000113783", venue: "XWAR", date: "2026-09-01", open: null, high: null, low: null, close: 80, volume: 0, trades: 0, turnover: 0, traded: false, lastTradeDate: "2026-08-20", currency: "PLN", source: "t", fetchedAt: "", status: "final" };
    const transactions = [
      tx({ id: "1", date: "2026-01-15", type: "BUY", isin: "PL0000113783", quantity: 1, amount: -800 }),
      tx({ id: "2", date: "2026-01-15", type: "BUY", isin: "PL0000117024", quantity: 1, amount: -900 }),
    ];
    const snap = valuePortfolio({ date: "2026-10-09", instruments: [], transactions, prices: new Map([["PL0000113783", stale]]), referenceIndex: index, couponRates: new Map() });
    expect(snap.holdings.find((h) => h.isin === "PL0000113783")!.flags).toEqual(["unknown_instrument", "stale_price"]);
    expect(snap.holdings.find((h) => h.isin === "PL0000117024")!.flags).toEqual(["unknown_instrument", "no_price"]);
  });
});

describe("transaction file", () => {
  it("parses, defaults currency and derives stable ids", () => {
    const rows = parseTransactionFile(
      JSON.stringify([
        { date: "2026-01-15", account: "bossa", type: "BUY", isin: "PL0000113783", quantity: 20, price: 80, amount: -16000, fee: 5 },
        { id: "custom", date: "2026-04-27", account: "bossa", type: "COUPON", isin: "PL0000113783", amount: 350 },
      ]),
      "test",
    );
    expect(rows[0]).toMatchObject({ currency: "PLN", source: "test", quantity: 20 });
    expect(rows[0]!.id).toHaveLength(16);
    expect(rows[0]!.id).toBe(transactionId({ date: "2026-01-15", account: "bossa", type: "BUY", isin: "PL0000113783", quantity: 20, price: 80, amount: -16000, fee: 5, currency: "PLN" }));
    expect(rows[1]!.id).toBe("custom");
    expect(() => parseTransactionFile(`[{"date":"2026-1-5","account":"a","type":"BUY","amount":1}]`, "t")).toThrow();
  });
});
