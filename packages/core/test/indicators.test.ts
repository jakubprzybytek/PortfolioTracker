import { describe, expect, it } from "vitest";
import { cpiIndicators, fxCurrencyOf, fxIndicator, summarize } from "../src/indicators/indicators.ts";

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

describe("summarize / fxIndicator", () => {
  it("takes the latest point and the last one on or before the same date a year earlier", () => {
    const s = summarize(fxIndicator("eur"), [
      { date: "2025-10-09", value: 4.27 },
      { date: "2025-10-10", value: 4.26 },
      { date: "2025-10-13", value: 4.25 },
      { date: "2026-10-12", value: 4.3889 },
    ]);
    expect(s).toMatchObject({ id: "fx-eur", name: "EUR/PLN", group: "Exchange rates", unit: "PLN", frequency: "daily" });
    expect(s.latest).toEqual({ date: "2026-10-12", value: 4.3889 });
    expect(s.yearAgo).toEqual({ date: "2025-10-10", value: 4.26 }); // 2025-10-12 was a Sunday
    expect(fxCurrencyOf("fx-usd")).toBe("USD");
    expect(fxCurrencyOf("cpi-mom")).toBeUndefined();
  });

  it("works on monthly points too, and without data", () => {
    const [mom] = cpiIndicators([
      { month: "2025-08", wr: 0, w: 208.73 },
      { month: "2026-08", wr: 0.003, w: 215.26519 },
    ]);
    expect(summarize(mom!, mom!.points)).toMatchObject({ latest: { date: "2026-08", value: 0.3 }, yearAgo: { date: "2025-08", value: 0 } });
    expect(summarize(mom!, [])).toMatchObject({ latest: null, yearAgo: null });
  });
});
