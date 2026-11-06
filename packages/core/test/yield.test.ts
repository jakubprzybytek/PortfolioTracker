import { describe, expect, it } from "vitest";
import type { InterestPeriod } from "../src/bonds/couponPeriods.ts";
import { irr, periodFlows, yearlyCouponFlows, yearsBetween } from "../src/bonds/yield.ts";

const period = (start: string, end: string, rate?: number): InterestPeriod => ({
  isin: "PLTEST000001",
  start,
  end,
  paymentDate: end,
  datesSource: "manual",
  ...(rate !== undefined ? { rate, rateSource: "manual" as const } : {}),
});

describe("yield", () => {
  it("irr: the annual rate that prices the flows", () => {
    expect(irr(100, [{ t: 1, amount: 110 }])).toBeCloseTo(0.1, 5);
    expect(irr(100, [{ t: 0.5, amount: 5 }, { t: 1, amount: 105 }])).toBeCloseTo(0.1025, 3);
  });

  it("irr: nothing to price gives 0", () => {
    expect(irr(0, [{ t: 1, amount: 110 }])).toBe(0);
    expect(irr(100, [])).toBe(0);
  });

  it("yearsBetween: 365.25 days a year", () => {
    expect(yearsBetween("2026-01-01", "2027-01-01")).toBeCloseTo(365 / 365.25, 6);
  });

  it("periodFlows: coupons of the periods ending after settlement, then the nominal", () => {
    const periods = [period("2026-08-12", "2026-11-12", 0.0713), period("2026-11-12", "2027-02-12"), period("2025-05-12", "2025-08-12", 0.07)];
    const r = periodFlows(100, periods, "2026-11-10", () => 0.08);
    expect(typeof r).not.toBe("string");
    if (typeof r === "string") return;
    expect(r.maturity).toBe("2027-02-12");
    expect(r.flows.map((f) => [f.date, f.kind, f.projected ?? false])).toEqual([
      ["2026-11-12", "coupon", false],
      ["2027-02-12", "coupon", true],
      ["2027-02-12", "redemption", false],
    ]);
    expect(r.flows[0]!.perBond).toBeCloseTo((100 * 0.0713 * 92) / 365, 2);
    expect(r.flows[1]!.perBond).toBeCloseTo((100 * 0.08 * 92) / 365, 2);
    expect(r.flows[2]!.perBond).toBe(100);
  });

  it("periodFlows: a period without a rate and nothing to assume makes the bond unprojectable", () => {
    expect(periodFlows(100, [period("2026-11-12", "2027-02-12")], "2026-11-10", () => undefined)).toBe("no rate for the period from 2026-11-12");
    expect(periodFlows(100, [], "2026-11-10", () => 0.05)).toMatch(/no coupon periods/);
  });

  it("yearlyCouponFlows: coupons on the maturity's day after today, then the nominal", () => {
    expect(yearlyCouponFlows(1000, 0.0175, "2029-04-25", "2026-11-06").map((f) => [f.date, f.kind, f.perBond])).toEqual([
      ["2027-04-25", "coupon", 17.5],
      ["2028-04-25", "coupon", 17.5],
      ["2029-04-25", "coupon", 17.5],
      ["2029-04-25", "redemption", 1000],
    ]);
    expect(yearlyCouponFlows(1000, 0, "2027-01-25", "2026-11-06")).toEqual([{ date: "2027-01-25", kind: "redemption", perBond: 1000, taxBase: 0 }]);
  });
});
