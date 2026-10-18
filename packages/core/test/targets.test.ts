import { describe, expect, it } from "vitest";
import { rebalance, TargetsInput, type Targets } from "../src/targets/targets.ts";

const t: Targets = { targets: { SHARES: 60, BONDS: 35, CASH: 5, OTHER: 0 }, bands: { SHARES: 5, BONDS: 5, CASH: 2, OTHER: 0 } };
// 100 000 in all: shares 70 %, bonds 25 %, cash 5 %.
const mix = { SHARES: 70_000, BONDS: 25_000, CASH: 5_000, OTHER: 0 };
const row = (rows: ReturnType<typeof rebalance>, k: string) => rows.find((r) => r.assetClass === k)!;

describe("rebalance", () => {
  it("compares the actual mix with the targets and their bands", () => {
    const rows = rebalance(mix, t, "SELL_AND_BUY");
    expect(row(rows, "SHARES")).toMatchObject({ actual: 70, target: 60, diff: 10, status: "OVER" });
    expect(row(rows, "BONDS")).toMatchObject({ actual: 25, diff: -10, status: "UNDER" });
    expect(row(rows, "CASH")).toMatchObject({ actual: 5, diff: 0, status: "WITHIN" });
    expect(row(rows, "OTHER").status).toBe("WITHIN");
  });

  it("a difference equal to the band is still within it", () => {
    const rows = rebalance({ SHARES: 65_000, BONDS: 30_000, CASH: 5_000, OTHER: 0 }, t, "SELL_AND_BUY");
    expect(row(rows, "SHARES").status).toBe("WITHIN");
    expect(row(rows, "BONDS").status).toBe("WITHIN");
  });

  it("sell and buy: every class to its target, the sales pay for the buys", () => {
    const rows = rebalance(mix, t, "SELL_AND_BUY");
    expect(row(rows, "SHARES").trade).toBe(-10_000);
    expect(row(rows, "BONDS").trade).toBe(10_000);
    expect(row(rows, "CASH").trade).toBe(0);
    expect(rows.reduce((s, r) => s + r.trade, 0)).toBeCloseTo(0, 6);
    for (const r of rows) expect(r.after).toBeCloseTo(r.target, 6);
  });

  it("new money: goes to the class below target first, nothing is sold", () => {
    const rows = rebalance(mix, t, "NEW_MONEY", 10_000);
    // New total 110 000: bonds' target is 38 500, 13 500 away, so all 10 000 go to bonds.
    expect(row(rows, "BONDS").trade).toBe(10_000);
    expect(row(rows, "SHARES").trade).toBe(0);
    expect(row(rows, "CASH").trade).toBe(0);
    expect(row(rows, "BONDS").after).toBeCloseTo((35_000 / 110_000) * 100, 6);
  });

  it("new money: classes below target are filled to the same fraction of their targets", () => {
    // Shares 60 000 (target 60 %), bonds 30 000 (35 %), cash 10 000 (5 %); +20 000 → total 120 000.
    // Targets: shares 72 000 (−12 000), bonds 42 000 (−12 000): both gaps are equal in PLN, but as a fraction of
    // the target bonds is further away, so it gets more: λ·72 000 − 60 000 + λ·42 000 − 30 000 = 20 000 → λ = 110/114.
    const rows = rebalance({ SHARES: 60_000, BONDS: 30_000, CASH: 10_000, OTHER: 0 }, t, "NEW_MONEY", 20_000);
    const lambda = 110_000 / 114_000;
    expect(row(rows, "SHARES").trade).toBeCloseTo(lambda * 72_000 - 60_000, 1);
    expect(row(rows, "BONDS").trade).toBeCloseTo(lambda * 42_000 - 30_000, 1);
    expect(row(rows, "CASH").trade).toBe(0);
    expect(rows.reduce((s, r) => s + r.trade, 0)).toBeCloseTo(20_000, 6);
  });

  it("new money: more than every gap together, the rest split by the targets", () => {
    const rows = rebalance(mix, t, "NEW_MONEY", 100_000);
    // New total 200 000: every class ends at its target (shares 120 000, bonds 70 000, cash 10 000).
    expect(row(rows, "SHARES").trade).toBe(50_000);
    expect(row(rows, "BONDS").trade).toBe(45_000);
    expect(row(rows, "CASH").trade).toBe(5_000);
    expect(row(rows, "OTHER").trade).toBe(0);
  });

  it("new money: the trades add up to the deposit to the grosz", () => {
    const rows = rebalance({ SHARES: 12_345.67, BONDS: 8_765.43, CASH: 321.09, OTHER: 1_000 }, { ...t, targets: { SHARES: 33.3, BONDS: 33.3, CASH: 33.4, OTHER: 0 } }, "NEW_MONEY", 1_000);
    expect(Math.round(rows.reduce((s, r) => s + r.trade, 0) * 100)).toBe(100_000);
    expect(rows.every((r) => r.trade >= 0)).toBe(true);
  });

  it("new money of nothing: no trades", () => {
    expect(rebalance(mix, t, "NEW_MONEY", 0).every((r) => r.trade === 0)).toBe(true);
  });
});

describe("TargetsInput", () => {
  it("needs the targets to add up to 100 %", () => {
    expect(TargetsInput.safeParse(t).success).toBe(true);
    expect(TargetsInput.safeParse({ ...t, targets: { ...t.targets, CASH: 10 } }).success).toBe(false);
    expect(TargetsInput.safeParse({ ...t, targets: { SHARES: 33.33, BONDS: 33.33, CASH: 33.34, OTHER: 0 } }).success).toBe(true);
    expect(TargetsInput.safeParse({ ...t, bands: { ...t.bands, OTHER: -1 } }).success).toBe(false);
  });
});
