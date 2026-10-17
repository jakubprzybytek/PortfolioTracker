import { describe, expect, it } from "vitest";
import type { HoldingSnapshot } from "../src/db/items.ts";
import { assetClassOf, drawdowns, historyPointOf, valueByClass, withZeroGaps } from "../src/valuation/history.ts";

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

describe("a position's days with gaps", () => {
  const p = (date: string, value: number) => ({ date, value, cost: value, quantity: 1 });
  it("fills the days it wasn't held with zero, and leaves consecutive days alone", () => {
    expect(withZeroGaps([p("2015-11-13", 5), p("2015-11-14", 6), p("2015-11-18", 7), p("2015-11-19", 8)]).map((x) => [x.date, x.value])).toEqual([
      ["2015-11-13", 5],
      ["2015-11-14", 6],
      ["2015-11-15", 0],
      ["2015-11-16", 0],
      ["2015-11-17", 0],
      ["2015-11-18", 7],
      ["2015-11-19", 8],
    ]);
    // Years out: a zero for every day, so the gap is as wide on the chart as it lasted.
    expect(withZeroGaps([p("2015-11-14", 6), p("2019-10-15", 7)])).toHaveLength(1430 + 2);
    expect(withZeroGaps([p("2020-01-01", 1), p("2020-01-03", 1)]).map((x) => x.date)).toEqual(["2020-01-01", "2020-01-02", "2020-01-03"]);
  });
});

describe("historyPointOf", () => {
  it("keeps what the charts use of a snapshot: date, totals, by type and by class, not the holdings", () => {
    const holdings = [{ type: "ETF", name: "World", value: 1000 }, { type: "BOND_RETAIL", name: "EDO", value: 500 }] as HoldingSnapshot[];
    const totals = { value: 1500, cost: 1400, gain: 100, couponsReceived: 0, cash: 50 };
    const byType = { ETF: { value: 1000, cost: 900 }, BOND_RETAIL: { value: 500, cost: 500 } };
    expect(historyPointOf({ date: "2026-10-14", holdings, totals, byType })).toEqual({ date: "2026-10-14", totals, byType, byClass: { SHARES: 1000, BONDS: 500, CASH: 50, OTHER: 0 } });
  });
});
