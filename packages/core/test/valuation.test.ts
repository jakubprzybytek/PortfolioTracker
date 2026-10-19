import { beforeAll, describe, expect, it } from "vitest";
import { parseMfCalculator } from "../src/mf/calculator.ts";
import { toReferenceIndex, type ReferenceIndex } from "../src/bonds/izIndex.ts";
import type { BondTerms } from "../src/bonds/terms.ts";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { positionKey, positionsAt } from "../src/valuation/positions.ts";
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
  it("accumulates buys, sells the oldest lots first (FIFO), tracks coupons", () => {
    const txs = [
      tx({ id: "1", date: "2025-01-10", type: "BUY", isin: "PL0000113783", quantity: 10, price: 80, amount: -8000, fee: 10 }),
      tx({ id: "2", date: "2025-03-10", type: "BUY", isin: "PL0000113783", quantity: 10, price: 82, amount: -8200, fee: 10 }),
      tx({ id: "3", date: "2025-04-27", type: "COUPON", isin: "PL0000113783", amount: 350 }),
      tx({ id: "4", date: "2025-06-01", type: "SELL", isin: "PL0000113783", quantity: 5, price: 83, amount: 4150, fee: 5 }),
      tx({ id: "5", date: "2025-06-02", type: "DEPOSIT", amount: 1000 }),
    ];
    const p = positionsAt(txs, "2025-12-31").get(positionKey("a", "PL0000113783"))!;
    expect(p.quantity).toBe(15);
    // FIFO: the 5 sold come from the first lot (8010 for 10 → 4005 out); the second lot (8210) is untouched
    expect(p.cost).toBe(12215);
    expect(p.lots).toEqual([
      { date: "2025-01-10", quantity: 5, cost: 4005, costNative: 4005, currency: "PLN" },
      { date: "2025-03-10", quantity: 10, cost: 8210, costNative: 8210, currency: "PLN" },
    ]);
    expect(p.realised).toEqual([{ id: "4", type: "SELL", date: "2025-06-01", quantity: 5, proceeds: 4150, cost: 4005, pairs: [{ buyDate: "2025-01-10", quantity: 5, cost: 4005 }] }]);
    expect(p.couponsReceived).toBe(350);
    expect(positionsAt(txs, "2025-02-01").get(positionKey("a", "PL0000113783"))!.quantity).toBe(10);
    expect(positionsAt(txs, "2024-12-31").size).toBe(0);
  });

  it("a sale spanning lots takes each at its own cost per unit; a split multiplies every lot", () => {
    const txs = [
      tx({ id: "1", date: "2025-01-10", type: "BUY", isin: "IE00B3YCGJ38", quantity: 2, amount: -2000 }),
      tx({ id: "2", date: "2025-02-10", type: "BUY", isin: "IE00B3YCGJ38", quantity: 2, amount: -3000 }),
      tx({ id: "3", date: "2025-03-10", type: "SPLIT", isin: "IE00B3YCGJ38", ratio: 100, amount: 0 }),
      tx({ id: "4", date: "2025-04-10", type: "SELL", isin: "IE00B3YCGJ38", quantity: 300, amount: 4000, fee: 10 }),
    ];
    const p = positionsAt(txs, "2025-12-31").get(positionKey("a", "IE00B3YCGJ38"))!;
    // 200 units of lot 1 (2000) + 100 of lot 2 (1500) sold; 100 of lot 2 left
    expect(p).toMatchObject({ quantity: 100, cost: 1500, lots: [{ date: "2025-02-10", quantity: 100, cost: 1500 }] });
    expect(p.realised).toEqual([
      // The sale takes the first buy's 200 (after the split) and 100 of the second's, each at its own cost per unit.
      { id: "4", type: "SELL", date: "2025-04-10", quantity: 300, proceeds: 4000, cost: 3500, pairs: [{ buyDate: "2025-01-10", quantity: 200, cost: 2000 }, { buyDate: "2025-02-10", quantity: 100, cost: 1500 }] },
    ]);
  });

  it("a write-off closes the bonds at 0: their remaining cost is a realised loss, cash doesn't move", () => {
    const txs = [
      tx({ id: "1", date: "2012-03-01", type: "BUY", isin: "PLGANT000204", quantity: 4, price: 100, amount: -4000, fee: 10 }),
      tx({ id: "2", date: "2012-05-04", type: "BUY", isin: "PLGANT000204", quantity: 3, price: 100, amount: -3000, fee: 7.5 }),
      tx({ id: "3", date: "2012-08-03", type: "COUPON", isin: "PLGANT000204", amount: 161.7 }),
      tx({ id: "4", date: "2013-05-31", type: "WRITE_OFF", isin: "PLGANT000204", quantity: 7, amount: 0, note: "issuer bankrupt" }),
    ];
    const p = positionsAt(txs, "2013-12-31").get(positionKey("a", "PLGANT000204"))!;
    expect(p).toMatchObject({ quantity: 0, cost: 0, couponsReceived: 161.7 });
    expect(p.realised).toEqual([
      { id: "4", type: "WRITE_OFF", date: "2013-05-31", quantity: 7, proceeds: 0, cost: 7017.5, pairs: [{ buyDate: "2012-03-01", quantity: 4, cost: 4010 }, { buyDate: "2012-05-04", quantity: 3, cost: 3007.5 }] },
    ]);
    // Held until the write-off
    expect(positionsAt(txs, "2013-05-30").get(positionKey("a", "PLGANT000204"))!.quantity).toBe(7);
    expect(parseTransactionFile(JSON.stringify([{ date: "2013-05-31", account: "a", type: "WRITE_OFF", isin: "PLGANT000204", quantity: 7, amount: 0 }]), "t")[0]!.type).toBe("WRITE_OFF");
  });

  it("keeps the same instrument in two accounts as separate positions", () => {
    const txs = [
      tx({ id: "1", date: "2025-01-10", type: "BUY", isin: "PL0000113783", quantity: 10, amount: -8000 }),
      tx({ id: "2", date: "2025-01-11", account: "b", type: "BUY", isin: "PL0000113783", quantity: 4, amount: -3300 }),
      tx({ id: "3", date: "2025-02-01", account: "b", type: "SELL", isin: "PL0000113783", quantity: 1, amount: 830 }),
    ];
    const positions = positionsAt(txs, "2025-12-31");
    expect(positions.size).toBe(2);
    expect(positions.get(positionKey("a", "PL0000113783"))).toMatchObject({ account: "a", quantity: 10, cost: 8000 });
    expect(positions.get(positionKey("b", "PL0000113783"))).toMatchObject({ account: "b", quantity: 3, cost: 2475 });
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
    const snap = valuePortfolio({ date: "2026-10-09", instruments, transactions, prices, referenceIndex: index, couponPeriods: new Map() });
    expect(snap.holdings.map((h) => `${h.account}/${h.code}`)).toEqual(["a/DS0432", "a/IZ0836"]);

    const izH = snap.holdings.find((h) => h.code === "IZ0836")!;
    // Nominal and accrued interest to the settlement day: Friday 2026-10-09 settles on Tuesday 2026-10-13 (T+2), where
    // the Ministry publishes ratio 1.10595 and 2.97 PLN; gpwcatalyst.pl quotes the same.
    expect(izH).toMatchObject({ quantity: 10, cleanPrice: 87.92, nominal: 1105.95, accruedInterest: 2.97, valuePerUnit: 975.32, value: 9753.2, cost: 9505, flags: [] });
    expect(izH.gain).toBe(248.2);

    const dsH = snap.holdings.find((h) => h.code === "DS0432")!;
    // 2026-04-25 → 2026-10-13 (settlement) = 171 days of 365 × 17.50 = 8.20
    expect(dsH).toMatchObject({ cleanPrice: 81.09, nominal: 1000, accruedInterest: 8.2, valuePerUnit: 819.1, value: 16382 });

    expect(snap.totals.value).toBe(26135.2);
    expect(snap.totals.cost).toBe(25510);
    expect(snap.byType["BOND_LISTED"]!.value).toBe(26135.2);
  });

  it("flags missing and stale prices and unknown instruments", () => {
    const stale: PriceItem = { PK: "INST#PL0000113783", SK: "PX#XWAR#2026-09-01", isin: "PL0000113783", venue: "XWAR", date: "2026-09-01", open: null, high: null, low: null, close: 80, volume: 0, trades: 0, turnover: 0, traded: false, lastTradeDate: "2026-08-20", currency: "PLN", source: "t", fetchedAt: "", status: "final" };
    const transactions = [
      tx({ id: "1", date: "2026-01-15", type: "BUY", isin: "PL0000113783", quantity: 1, amount: -800 }),
      tx({ id: "2", date: "2026-01-15", type: "BUY", isin: "PL0000117024", quantity: 1, amount: -900 }),
    ];
    const snap = valuePortfolio({ date: "2026-10-09", instruments: [], transactions, prices: new Map([["PL0000113783", stale]]), referenceIndex: index, couponPeriods: new Map() });
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
