import { describe, expect, it } from "vitest";
import { benchmarkAt, benchmarkInPln, benchmarkReturn, BENCHMARKS } from "../src/benchmarks/benchmarks.ts";
import { cpiLevels, growthOf100 } from "../src/valuation/returns.ts";

const fx = new Map([
  [
    "EUR",
    [
      { date: "2025-01-02", mid: 4.2 },
      { date: "2025-01-03", mid: 4.3 },
    ],
  ],
]);

describe("benchmarks", () => {
  it("are a fixed list of a Polish and a world index", () => {
    expect(BENCHMARKS.map((b) => b.id)).toEqual(["WIG", "MSCI_WORLD"]);
  });

  it("converts closes to PLN at the day's NBP rate, the latest on or before it; none before the first rate", () => {
    const closes = [
      { date: "2025-01-06", close: 10 }, // Monday: Friday's rate
      { date: "2025-01-01", close: 10 }, // before any rate
      { date: "2025-01-02", close: 10 },
    ];
    expect(benchmarkInPln(closes, "EUR", fx)).toEqual([
      { date: "2025-01-02", value: 42 },
      { date: "2025-01-06", value: 43 },
    ]);
    expect(benchmarkInPln([{ date: "2025-01-02", close: 5 }], "PLN", new Map())).toEqual([{ date: "2025-01-02", value: 5 }]);
  });

  it("values a day at the latest close on or before it; returns over a period", () => {
    const s = [
      { date: "2025-01-02", value: 100 },
      { date: "2025-01-03", value: 110 },
      { date: "2025-01-06", value: 121 },
    ];
    expect(benchmarkAt(s, "2025-01-01")).toBeUndefined();
    expect(benchmarkAt(s, "2025-01-05")).toBe(110);
    expect(benchmarkAt(s, "2025-02-01")).toBe(121);
    expect(benchmarkReturn(s, "2025-01-03", "2025-01-06")).toBeCloseTo(0.1, 6);
    expect(benchmarkReturn(s, "2024-12-31", "2025-01-06")).toBeNull();
  });
});

describe("growthOf100 with benchmarks", () => {
  const points = [
    { date: "2025-01-31", total: 1000, netDeposits: 1000 },
    { date: "2025-07-31", total: 1000, netDeposits: 1000 },
    { date: "2026-01-31", total: 1000, netDeposits: 1000 },
  ];
  const levels = cpiLevels([], [
    { month: "2025-01", wr: 0 },
    { month: "2025-02", wr: 0 },
  ]);

  it("rebases each benchmark to 100 on the first day", () => {
    const g = growthOf100(points, levels, [
      { id: "A", points: [{ date: "2025-01-30", value: 50 }, { date: "2025-07-31", value: 60 }] },
      { id: "LATE", points: [{ date: "2025-03-01", value: 1 }] }, // starts after the first day: no line
    ]);
    expect(g.map((p) => p.bench["A"])).toEqual([100, 120, 120]);
    expect(g.map((p) => p.bench["LATE"])).toEqual([null, null, null]);
  });

  it("adds the margin a year on top of CPI", () => {
    const g = growthOf100(points, levels, [], 0.02);
    expect(g[0]!.cpiPlus).toBe(100);
    // CPI flat; a year (365 of 365.25 days) at 2 %.
    expect(g[2]!.cpiPlus).toBeCloseTo(100 * 1.02 ** (365 / 365.25), 3);
    expect(g[2]!.cpi).toBe(100);
  });
});
