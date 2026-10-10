import { describe, expect, it } from "vitest";
import { retailRatePeriods, valueRetailBond, type RetailBondSeries } from "../src/bonds/retail.ts";

const edo: RetailBondSeries = {
  series: "EDO1034",
  kind: "EDO",
  nominal: 100,
  purchaseDate: "2024-10-15",
  maturity: "2034-10-15",
  firstRate: 0.0655,
  margin: 0.02,
  capitalises: true,
  redemptionFee: 3,
};

const coi: RetailBondSeries = { ...edo, series: "COI1028", kind: "COI", maturity: "2028-10-15", firstRate: 0.0605, margin: 0.015, capitalises: false, redemptionFee: 2 };

// CPI y/y published in Sept 2025 (for the period starting Oct 2025) = 2.9 %; Sept 2026 unknown.
const cpi = new Map([["2025-09", 0.029]]);

describe("retailRatePeriods", () => {
  it("fixes the first period and derives later ones from CPI + margin", () => {
    const periods = retailRatePeriods(edo, cpi);
    expect(periods).toHaveLength(10);
    expect(periods[0]).toEqual({ start: "2024-10-15", end: "2025-10-15", rate: 0.0655, basis: "FIXED" });
    expect(periods[1]).toEqual({ start: "2025-10-15", end: "2026-10-15", rate: 0.049, basis: "CPI+margin", cpiMonth: "2025-09" });
    expect(periods[2]).toMatchObject({ start: "2026-10-15", basis: "unknown", rate: 0.049, cpiMonth: "2026-09" });
    expect(periods.at(-1)!.end).toBe("2034-10-15");
  });

  it("floors CPI at zero so the rate never drops below the margin", () => {
    const periods = retailRatePeriods(edo, new Map([["2025-09", -0.012]]));
    expect(periods[1]!.rate).toBe(0.02);
  });
});

describe("valueRetailBond", () => {
  const periods = retailRatePeriods(edo, cpi);

  it("accrues the first-year rate daily", () => {
    expect(valueRetailBond(edo, periods, "2024-10-15")).toMatchObject({ base: 100, accrued: 0, value: 100 });
    // 182 days of 365 × 6.55 PLN
    expect(valueRetailBond(edo, periods, "2025-04-15")).toMatchObject({ base: 100, accrued: 3.27, value: 103.27 });
    expect(valueRetailBond(edo, periods, "2025-10-14").accrued).toBe(6.53);
  });

  it("capitalises EDO interest at the period end and accrues on the new base", () => {
    const v = valueRetailBond(edo, periods, "2025-10-15");
    expect(v.base).toBe(106.55);
    expect(v.accrued).toBe(0);
    // 100 days later at 4.9 % on 106.55
    expect(valueRetailBond(edo, periods, "2026-01-23").accrued).toBe(1.43);
  });

  it("pays COI interest out instead of capitalising", () => {
    const p = retailRatePeriods(coi, cpi);
    const v = valueRetailBond(coi, p, "2026-01-23");
    expect(v.base).toBe(100);
    expect(v.paidOut).toBe(6.05);
    // 100/365 × 4.4 % × 100
    expect(v.accrued).toBe(1.21);
    expect(v.value).toBe(101.21);
  });

  it("flags unknown rates, dates before purchase and maturity", () => {
    expect(valueRetailBond(edo, periods, "2026-11-01").problem).toBe("unknown_rate");
    expect(valueRetailBond(edo, periods, "2024-01-01").problem).toBe("before_purchase");
    expect(valueRetailBond(edo, periods, "2034-10-15").problem).toBe("matured");
  });
});
