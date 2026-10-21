import { describe, expect, it } from "vitest";
import {
  cpiAt,
  cpiLevels,
  growthOf100,
  yearlyReturns,
  type ReturnPoint,
} from "../src/valuation/returns.ts";

const ytd2025 = Array.from({ length: 12 }, (_, i) => ({
  month: `2025-${String(i + 1).padStart(2, "0")}`,
  value: 100 + (i + 1) * 0.5,
})); // December: 106.0

describe("cpiLevels", () => {
  it("chains GUS's since-December figures, so a year's inflation is exactly December's", () => {
    const levels = cpiLevels(
      [
        ...ytd2025,
        { month: "2026-01", value: 100.7 },
        { month: "2026-02", value: 101.0 },
      ],
      [],
    );
    const at = (m: string) => levels.find((l) => l.month === m)!.level;
    expect(levels[0]).toEqual({ month: "2024-12", level: 100, gus: true });
    expect(at("2025-12") / at("2024-12")).toBeCloseTo(1.06, 12);
    expect(at("2026-02") / at("2025-12")).toBeCloseTo(1.01, 12);
    expect(levels.every((l) => l.gus)).toBe(true);
  });

  it("fills months without the GUS figure from the monthly chain, marked as not GUS's", () => {
    const levels = cpiLevels(ytd2025, [
      { month: "2025-12", wr: 0.001 }, // the GUS figure wins
      { month: "2026-01", wr: 0.007 },
      { month: "2026-02", wr: 0.003 },
    ]);
    const jan = levels.find((l) => l.month === "2026-01")!;
    expect(jan.level).toBeCloseTo(106 * 1.007, 10);
    expect(jan.gus).toBe(false);
    expect(levels.at(-1)!.month).toBe("2026-02");
  });

  it("only the monthly chain: compounded from 100", () => {
    const levels = cpiLevels(
      [],
      [
        { month: "2026-01", wr: 0.01 },
        { month: "2026-02", wr: -0.005 },
      ],
    );
    expect(levels.map((l) => l.month)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(levels.at(-1)!.level).toBeCloseTo(100 * 1.01 * 0.995, 10);
  });
});

describe("cpiAt", () => {
  const levels = cpiLevels(ytd2025, []);
  it("counts a month's level at its last day, days in between geometrically, flat after the last month", () => {
    expect(cpiAt(levels, "2025-01-31")!.level).toBeCloseTo(100.5, 10);
    const mid = cpiAt(levels, "2025-02-14")!.level; // 14 of 28 days
    expect(mid).toBeCloseTo(100.5 * (101 / 100.5) ** 0.5, 10);
    expect(cpiAt(levels, "2026-03-10")).toEqual({
      level: 106,
      through: "2025-12",
    });
    expect(cpiAt(levels, "2024-05-01")).toBeUndefined();
  });
});

describe("yearlyReturns", () => {
  // 1000 put in on 2024-06-01; +10 % by the end of 2024; +10 % by mid 2025, then 1000 more; +10 % by the end of 2025;
  // 2026 so far: flat.
  const points: ReturnPoint[] = [
    { date: "2024-06-01", total: 1000, netDeposits: 1000 },
    { date: "2024-12-31", total: 1100, netDeposits: 1000 },
    { date: "2025-06-29", total: 1210, netDeposits: 1000 },
    { date: "2025-06-30", total: 2210, netDeposits: 2000 },
    { date: "2025-12-31", total: 2431, netDeposits: 2000 },
    { date: "2026-03-31", total: 2431, netDeposits: 2000 },
  ];
  // 2024 from the monthly chain (+0.2 % a month), 2025 on from GUS's figures since December.
  const mom2024 = Array.from({ length: 12 }, (_, i) => ({
    month: `2024-${String(i + 1).padStart(2, "0")}`,
    wr: 0.002,
  }));
  const levels = cpiLevels(
    [...ytd2025, { month: "2026-01", value: 100.5 }],
    mom2024,
  );
  const { years, total } = yearlyReturns(points, levels);

  it("a whole year: time-weighted return, profit, inflation December on December and the real return", () => {
    const y = years.find((r) => r.year === 2025)!;
    expect(y).toMatchObject({
      from: "2024-12-31",
      to: "2025-12-31",
      partial: false,
      startValue: 1100,
      netDeposits: 1000,
      endValue: 2431,
      profit: 331,
      cpiThrough: "2025-12",
      cpiExact: true,
    });
    expect(y.twr).toBeCloseTo(0.21, 6);
    expect(y.inflation).toBeCloseTo(0.06, 6);
    expect(y.real).toBeCloseTo(1.21 / 1.06 - 1, 6);
    // Money-weighted: more money in the stronger second half, but both halves +10 %: about the same as the TWR.
    expect(y.xirr!).toBeGreaterThan(0.2);
    expect(y.xirr!).toBeLessThan(0.22);
  });

  it("the first year and the year so far are partial, over their own days (not a year)", () => {
    expect(years.map((r) => r.year)).toEqual([2026, 2025, 2024]);
    const first = years.find((r) => r.year === 2024)!;
    expect(first).toMatchObject({
      from: "2024-06-01",
      partial: true,
      startValue: 0,
      netDeposits: 1000,
      profit: 100,
      cpiExact: false,
    });
    expect(first.inflation).toBeCloseTo(1.002 ** (7 - 1 / 30) - 1, 6); // 1 June to 31 December
    expect(first.twr).toBeCloseTo(0.1, 6);
    expect(first.xirr).toBeCloseTo(0.1, 4);
    const now = years[0]!;
    expect(now).toMatchObject({ partial: true, twr: 0, cpiThrough: "2026-01" });
    expect(now.inflation).toBeCloseTo(0.005, 6); // CPI known to January: flat after it
  });

  it("the whole history, also per year", () => {
    expect(total).toMatchObject({
      year: null,
      from: "2024-06-01",
      to: "2026-03-31",
      netDeposits: 2000,
      profit: 431,
    });
    expect(total!.twr).toBeCloseTo(1.1 ** 3 - 1, 6);
    expect(total!.twrPerYear).toBeCloseTo(1.331 ** (1 / total!.years) - 1, 3);
    expect(total!.real).toBeCloseTo(1.331 / (1 + total!.inflation!) - 1, 6);
    expect(total!.xirr).toBeGreaterThan(0.1); // a year
  });

  it("nothing to measure", () => {
    expect(yearlyReturns([], levels)).toEqual({ years: [], total: null });
  });
});

describe("growthOf100", () => {
  it("chains the time-weighted return from 100 and rebases CPI on the first day", () => {
    const levels = cpiLevels(ytd2025, []);
    const g = growthOf100(
      [
        { date: "2025-01-31", total: 1000, netDeposits: 1000 },
        { date: "2025-02-28", total: 2100, netDeposits: 2000 }, // +1000 put in, +100 gained: +10 %
        { date: "2025-12-31", total: 2100, netDeposits: 2000 },
      ],
      levels,
    );
    expect(g.map((p) => p.portfolio)).toEqual([100, 110, 110]);
    expect(g[0]!.cpi).toBe(100);
    expect(g[2]!.cpi).toBeCloseTo((100 * 106) / 100.5, 3);
    expect(
      growthOf100(
        [{ date: "2020-01-01", total: 1, netDeposits: 1 }],
        levels,
      )[0]!.cpi,
    ).toBeNull();
  });
});
