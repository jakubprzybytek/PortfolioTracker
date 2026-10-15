import { describe, expect, it } from "vitest";
import type { HoldingSnapshot } from "../src/db/items.ts";
import { assetClassOf, drawdowns, valueByClass } from "../src/valuation/history.ts";

describe("assetClassOf", () => {
  it("maps instrument types onto classes; a bond ETF is bonds", () => {
    expect(assetClassOf({ type: "ETF", name: "Vanguard FTSE All-World" })).toBe("SHARES");
    expect(assetClassOf({ type: "ETF", name: "iShares Euro Corporate Bond UCITS ETF" })).toBe("BONDS");
    expect(assetClassOf({ type: "BOND_RETAIL", name: "EDO1036" })).toBe("BONDS");
    expect(assetClassOf({ type: "CURRENCY", name: "EUR cash" })).toBe("CASH");
    expect(assetClassOf({ type: "FUND_MANUAL", name: "Fund" })).toBe("OTHER");
  });
});

describe("valueByClass", () => {
  it("sums positions per class and adds the cash of the totals", () => {
    const h = (type: HoldingSnapshot["type"], name: string, value: number | null) => ({ type, name, value }) as HoldingSnapshot;
    const holdings = [h("ETF", "World", 1000), h("ETF", "Global Bond", 300), h("BOND_LISTED", "DS", 200.005), h("FUND_MANUAL", "X", null)];
    expect(valueByClass({ holdings, totals: { value: 1500, cost: 0, gain: 0, couponsReceived: 0, cash: 50 } })).toEqual({ SHARES: 1000, BONDS: 500.01, CASH: 50, OTHER: 0 });
    expect(valueByClass({ holdings: [], totals: { value: 0, cost: 0, gain: 0, couponsReceived: 0 } }).CASH).toBe(0); // older snapshots: no cash
  });
});

describe("drawdowns", () => {
  it("is the fall from the best so far, on returns, not on the value", () => {
    const dd = drawdowns([
      { date: "d1", total: 1000, netDeposits: 1000 },
      { date: "d2", total: 1100, netDeposits: 1000 }, // +10 %: a new high
      { date: "d3", total: 990, netDeposits: 1000 }, // −10 % from it
      { date: "d4", total: 1990, netDeposits: 2000 }, // 1000 put in: no gain, still −10 %
      { date: "d5", total: 990, netDeposits: 1000 }, // 1000 taken out: no loss either
      { date: "d6", total: 1300, netDeposits: 1000 }, // above the old high
    ]).map((d) => d.drawdown);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBe(0);
    expect(dd[2]).toBeCloseTo(-0.1, 6);
    expect(dd[3]).toBeCloseTo(-0.1, 4);
    expect(dd[4]).toBeCloseTo(-0.1, 4);
    expect(dd[5]).toBe(0);
  });

  it("starts at the first money in (days with nothing don't count)", () => {
    const dd = drawdowns([
      { date: "d0", total: 0, netDeposits: 0 },
      { date: "d1", total: 500, netDeposits: 500 },
      { date: "d2", total: 450, netDeposits: 500 },
    ]);
    expect(dd.map((d) => d.drawdown)).toEqual([0, 0, -0.1]);
  });
});
