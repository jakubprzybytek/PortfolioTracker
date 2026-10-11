import { beforeAll, describe, expect, it } from "vitest";
import type { InstrumentItem, TransactionItem } from "../src/db/items.ts";
import { parseRetailRates, type RetailTerms } from "../src/mf/retailRates.ts";
import { retailLotsAt, retailValueHistory, valueRetailLots } from "../src/valuation/retailLots.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";
import { toReferenceIndex } from "../src/bonds/izIndex.ts";
import { FIXTURES, fixture } from "./fixtures.ts";

let edo0332: RetailTerms;
beforeAll(() => {
  edo0332 = parseRetailRates(fixture(FIXTURES.mfRetail)).get("EDO0332")!;
});

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: `TX#${t.date}#${t.id ?? "x"}`, GSI1PK: "TX", GSI1SK: `${t.date}#${t.id ?? "x"}`, id: t.id ?? "x", account: "a", currency: "PLN", source: "test", isin: "PL0000114518", ...t }) as TransactionItem;

describe("retailLotsAt", () => {
  it("starts each lot on its valueDate and takes sales from the oldest lot", () => {
    const txs = [
      tx({ id: "1", date: "2022-03-01", valueDate: "2022-03-11", type: "BUY", quantity: 1202, price: 100, amount: -120200 }),
      tx({ id: "2", date: "2022-03-15", valueDate: "2022-03-16", type: "BUY", quantity: 50, price: 100, amount: -5000 }),
      tx({ id: "3", date: "2026-03-20", type: "SELL", quantity: 1210, amount: 165000 }),
    ];
    expect(retailLotsAt(txs, "2022-03-14")).toEqual([{ valueDate: "2022-03-11", quantity: 1202 }]);
    expect(retailLotsAt(txs, "2026-10-11")).toEqual([{ valueDate: "2022-03-16", quantity: 42 }]);
  });
});

describe("valueRetailLots", () => {
  it("matches the reference sheet: EDO0332 bought 2022-03-11 is worth 138.37 per bond on 2026-10-11", () => {
    const r = valueRetailLots(edo0332, [{ valueDate: "2022-03-11", quantity: 1202 }], "2026-10-11");
    expect(r.value / r.quantity).toBeCloseTo(138.37, 2);
    expect(r.rate).toEqual({ current: 0.0345, previous: 0.0655 });
    expect(r.flags).toEqual([]);
  });

  it("flags a lot whose current year's rate isn't published yet", () => {
    const r = valueRetailLots(edo0332, [{ valueDate: "2022-03-11", quantity: 1 }], "2027-03-20"); // year 6 not in the file
    expect(r.flags).toEqual(["rate_pending"]);
  });
});

describe("valuePortfolio with retail bonds", () => {
  it("values a retail position per lot, without a market price", () => {
    const inst = { PK: "INST#PL0000114518", SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: "PL0000114518", isin: "PL0000114518", code: "EDO0332", name: "EDO0332", type: "BOND_RETAIL", currency: "PLN", venue: "CALC", sourceIds: {}, active: true, live: false, retail: edo0332, updatedAt: "" } as InstrumentItem;
    const transactions = [
      tx({ id: "1", date: "2022-03-01", valueDate: "2022-03-11", type: "BUY", quantity: 10, price: 100, amount: -1000 }),
      tx({ id: "2", date: "2022-03-15", valueDate: "2022-03-16", type: "BUY", quantity: 10, price: 99.9, amount: -999 }),
    ];
    const snap = valuePortfolio({ date: "2026-10-11", instruments: [inst], transactions, prices: new Map(), referenceIndex: toReferenceIndex([]), couponRates: new Map() });
    const h = snap.holdings[0]!;
    expect(h).toMatchObject({ code: "EDO0332", quantity: 20, cost: 1999, cleanPrice: null, flags: [], rate: { current: 0.0345, previous: 0.0655 } });
    expect(h.value).toBeGreaterThan(2760); // ≈ 20 × 138.3
    expect(h.valuePerUnit).toBeCloseTo(138.36, 1);
  });
});

describe("retailValueHistory", () => {
  it("gives the daily value per bond while the bonds are held", () => {
    const txs = [
      tx({ id: "1", date: "2022-03-01", valueDate: "2022-03-11", type: "BUY", quantity: 10, price: 100, amount: -1000 }),
      tx({ id: "2", date: "2022-03-20", type: "SELL", quantity: 10, amount: 1000 }),
    ];
    const h = retailValueHistory(edo0332, txs, "2022-03-01", "2022-04-01");
    expect(h[0]).toEqual({ date: "2022-03-11", value: 100 }); // starts when interest starts
    expect(h.at(-1)!.date).toBe("2022-03-19"); // sold on the 20th
    expect(h.at(-1)!.value).toBeCloseTo(100 + 2.2 * (8 / 365), 2);
    expect(retailValueHistory(edo0332, txs, "2026-01-01", "2026-02-01")).toEqual([]);
  });
});
