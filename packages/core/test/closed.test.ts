import { describe, expect, it } from "vitest";
import type { InstrumentItem, TransactionItem } from "../src/db/items.ts";
import { closedPositions, formerInstruments } from "../src/valuation/closed.ts";
import { positionsAt } from "../src/valuation/positions.ts";

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: `TX#${t.date}#${t.id ?? "x"}`, GSI1PK: "TX", GSI1SK: `${t.date}#${t.id ?? "x"}`, id: "x", account: "a", currency: "PLN", source: "test", ...t }) as TransactionItem;
const inst = (isin: string, code: string, type: InstrumentItem["type"] = "BOND_CORPORATE") => ({ isin, code, name: `${code} name`, type, currency: "PLN" }) as InstrumentItem;

// Made-up bonds: one sold in two parts, one written off, one still held, foreign cash exchanged back.
const txs = [
  tx({ id: "1", date: "2012-03-01", type: "BUY", isin: "PLAAAAAAAAA1", quantity: 10, amount: -1000, fee: 3 }),
  tx({ id: "2", date: "2012-06-01", type: "SELL", isin: "PLAAAAAAAAA1", quantity: 4, amount: 420, fee: 1 }),
  tx({ id: "3", date: "2012-08-01", type: "COUPON", isin: "PLAAAAAAAAA1", amount: 30 }),
  tx({ id: "4", date: "2013-01-15", type: "REDEMPTION", isin: "PLAAAAAAAAA1", quantity: 6, amount: 600 }),
  tx({ id: "5", date: "2012-03-02", type: "BUY", isin: "PLBBBBBBBBB2", quantity: 7, amount: -700 }),
  tx({ id: "6", date: "2013-05-31", type: "WRITE_OFF", isin: "PLBBBBBBBBB2", quantity: 7, amount: 0 }),
  tx({ id: "7", date: "2013-02-01", type: "BUY", isin: "PLCCCCCCCCC3", quantity: 2, amount: -200 }),
  tx({ id: "8", date: "2013-02-01", type: "BUY", isin: "XXEUR0000000", quantity: 100, amount: -430 }),
  tx({ id: "9", date: "2013-03-01", type: "SELL", isin: "XXEUR0000000", quantity: 100, amount: 440 }),
];
const instruments = [inst("PLAAAAAAAAA1", "AAA1214"), inst("PLBBBBBBBBB2", "BBB0513"), inst("PLCCCCCCCCC3", "CCC0920"), inst("XXEUR0000000", "EUR", "CURRENCY")];

describe("closed positions", () => {
  it("sums each closed position's disposals: proceeds, FIFO cost, realised gain, coupons; open ones and foreign cash are left out", () => {
    const closed = closedPositions(positionsAt(txs, "2026-10-16").values(), instruments);
    expect(closed).toEqual([
      // 1003 for 10: 4 sold for 420 (net of the fee in the amount) cost 401.2, 6 redeemed for 600 cost 601.8.
      { account: "a", isin: "PLAAAAAAAAA1", code: "AAA1214", name: "AAA1214 name", type: "BOND_CORPORATE", currency: "PLN", firstDate: "2012-03-01", closedDate: "2013-01-15", quantity: 10, proceeds: 1020, cost: 1003, gain: 17, gainPct: 1.69, couponsReceived: 30 },
      // Written off: nothing back, the whole cost lost.
      { account: "a", isin: "PLBBBBBBBBB2", code: "BBB0513", name: "BBB0513 name", type: "BOND_CORPORATE", currency: "PLN", firstDate: "2012-03-02", closedDate: "2013-05-31", quantity: 7, proceeds: 0, cost: 700, gain: -700, gainPct: -100, couponsReceived: 0 },
    ]);
    // Before its redemption the first bond is still partly held: not closed.
    expect(closedPositions(positionsAt(txs, "2012-12-31").values(), instruments)).toEqual([]);
  });

  it("finds the instruments traded but not held now, with their first and last transaction dates", () => {
    expect(formerInstruments(txs, new Set(["PLCCCCCCCCC3", "XXEUR0000000"]))).toEqual(
      new Map([
        ["PLAAAAAAAAA1", { firstDate: "2012-03-01", lastDate: "2013-01-15" }],
        ["PLBBBBBBBBB2", { firstDate: "2012-03-02", lastDate: "2013-05-31" }],
      ]),
    );
  });
});
