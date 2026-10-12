import { describe, expect, it } from "vitest";
import { cpiIndicators } from "../src/indicators/cpi.ts";

describe("cpiIndicators", () => {
  // Stored CPI_REF values (MF calculator), deliberately out of order.
  const months = [
    { month: "2026-08", wr: 0.003, w: 215.26519 },
    { month: "2026-06", wr: -0.005, w: 212.91798 },
    { month: "2026-07", wr: 0.008, w: 214.62133 },
  ];

  it("gives CPI m/m in % and the reference index, oldest first", () => {
    const [mom, index] = cpiIndicators(months);
    expect(mom!.id).toBe("cpi-mom");
    expect(mom!.unit).toBe("%");
    expect(mom!.points).toEqual([
      { date: "2026-06", value: -0.5 },
      { date: "2026-07", value: 0.8 },
      { date: "2026-08", value: 0.3 },
    ]);
    expect(index!.id).toBe("cpi-index");
    expect(index!.points.map((p) => p.value)).toEqual([212.91798, 214.62133, 215.26519]);
  });

  it("is empty without data", () => {
    expect(cpiIndicators([]).every((i) => i.points.length === 0)).toBe(true);
  });
});
