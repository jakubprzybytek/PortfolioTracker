import { describe, expect, it } from "vitest";
import type { InterestPeriod } from "../src/bonds/couponPeriods.ts";
import { curveAt, fixedCurve, fixedYield, priceAdjustedMargin, wzCurve, type CurvePoint } from "../src/catalyst/curve.ts";
import { catalystKeys, type CatalystBondItem, type CatalystSessionItem, type CatalystTermsItem } from "../src/catalyst/items.ts";
import { liquidity } from "../src/catalyst/liquidity.ts";
import { DEFAULT_CATALYST_ASSUMPTIONS, screenRow, type ScreenInput } from "../src/catalyst/screen.ts";
import { addDays } from "../src/dates.ts";
import { isSettlementDay } from "../src/settlement.ts";

describe("curves", () => {
  it("a fixed bond at par yields its coupon (before tax and commission)", () => {
    // Settles 2026-11-10; 5 % yearly to 2028-11-10, bought at 100 without accrued interest.
    expect(fixedYield({ maturity: "2028-11-10", close: 100, rate: 0.05, accruedInterest: 0, nominal: 1000 }, "2026-11-10")).toBeCloseTo(0.05, 3);
    // Below par it yields more; a zero-coupon at 95 a year off yields about 5.3 %.
    expect(fixedYield({ maturity: "2028-11-10", close: 98, rate: 0.05, accruedInterest: 0, nominal: 1000 }, "2026-11-10")).toBeGreaterThan(0.06);
    expect(fixedYield({ maturity: "2027-11-10", close: 95, rate: null, accruedInterest: 0, nominal: 1000 }, "2026-11-10")).toBeCloseTo(1 / 0.95 - 1, 3);
  });

  it("the fixed curve: DS/PS/WS/OK only, by years, nothing under three months", () => {
    const q = (code: string, maturity: string, close: number, rate: number | null) => ({ code, maturity, close, rate, accruedInterest: 0, nominal: 1000 });
    const points = fixedCurve([q("DS0432", "2032-04-25", 82, 0.0175), q("OK1226", "2026-12-25", 99.5, null), q("WZ0330", "2030-03-25", 97, 0.0388), q("PS0130", "2030-01-25", 100, 0.05), q("KRU0829", "2029-08-01", 101, 0.08)], "2026-11-06");
    expect(points.map((p) => p.code)).toEqual(["PS0130", "DS0432"]);
    expect(points[0]!.years).toBeCloseTo(3.2, 1);
    expect(wzCurve([q("WZ0330", "2030-03-25", 97, 0.0388)], "2026-11-06")[0]!.value).toBeCloseTo(0.03 / 3.37, 3);
  });

  it("curveAt: straight lines between points, flat beyond the ends", () => {
    const points: CurvePoint[] = [
      { years: 1, value: 0.04, code: "A" },
      { years: 3, value: 0.05, code: "B" },
    ];
    expect(curveAt(points, 2)).toBeCloseTo(0.045, 6);
    expect(curveAt(points, 0.5)).toBe(0.04);
    expect(curveAt(points, 10)).toBe(0.05);
    expect(curveAt([], 2)).toBeNull();
  });

  it("price-adjusted margin: the margin less what's paid over par, spread over the years", () => {
    expect(priceAdjustedMargin(0.03, 101, 2)).toBeCloseTo(0.025, 6);
    expect(priceAdjustedMargin(0.03, 98, 2)).toBeCloseTo(0.04, 6);
  });
});

describe("liquidity", () => {
  const s = (trades: number, turnover = trades * 10_000) => ({ trades, turnover });
  it("levels from the share of sessions traded and the median turnover", () => {
    expect(liquidity(Array.from({ length: 30 }, () => s(2, 30_000)), []).level).toBe("high");
    expect(liquidity(Array.from({ length: 30 }, () => s(2, 5_000)), []).level).toBe("medium"); // traded every day, small
    expect(liquidity(Array.from({ length: 30 }, (_, i) => s(i % 2)), []).level).toBe("medium");
    expect(liquidity(Array.from({ length: 30 }, (_, i) => s(i % 5 === 0 ? 1 : 0)), []).level).toBe("low");
    expect(liquidity(Array.from({ length: 30 }, () => s(0)), []).level).toBe("none");
  });

  it("measures: shares, median turnover, spread, days to sell 10 000", () => {
    const l = liquidity([...Array.from({ length: 60 }, () => s(0)), ...Array.from({ length: 30 }, (_, i) => (i < 15 ? s(1, 20_000) : s(0)))], [{ bid: { price: 99.5, volume: 10 }, ask: { price: 100.5 } }, { bid: { price: 99.8, volume: 4 }, ask: { price: 100.2 } }]);
    expect(l).toMatchObject({ traded30: 0.5, traded90: 0.1667, medianTurnover30: 20_000, trades30: 15, medianSpread30: 0.7, bid: { price: 99.8, volume: 4 } });
    // Average daily turnover 10 000; 20 % of it a day → 5 sessions.
    expect(l.daysToSell10k).toBe(5);
  });
});

// --- screen rows -----------------------------------------------------------------------------

const DATE = "2026-11-05";
const bond = (b: Partial<CatalystBondItem> & { code: string }): CatalystBondItem => ({
  ...catalystKeys.bond(`PL${b.code}`),
  GSI1PK: "BOND",
  GSI1SK: b.code,
  isin: `PL${b.code}`,
  segment: "corporate",
  currency: "PLN",
  markets: ["GPW ASO"],
  maturity: "2029-11-09",
  nominal: 1000,
  status: "listed",
  firstSeen: "2025-01-02",
  lastSeen: DATE,
  updatedAt: "",
  ...b,
});
/** 30 sessions up to DATE on the bond's market, traded on every other one, closing at `close`. */
const sessions = (b: CatalystBondItem, close: number, trades = (i: number) => i % 2): CatalystSessionItem[] => {
  const days: string[] = [];
  for (let d = DATE; days.length < 30; d = addDays(d, -1)) if (isSettlementDay(d)) days.unshift(d);
  return days.map((date, i) => ({ ...catalystKeys.session(b.isin, date, b.markets[0]!), isin: b.isin, date, market: b.markets[0]!, rate: 0.06, accruedInterest: 0, nominal: b.nominal, close, reference: close, open: null, low: null, high: null, last: null, trades: trades(i), volume: 0, turnover: trades(i) * 20_000, blockVolume: 0, blockTurnover: 0, source: "t", fetchedAt: "" }));
};
/** Yearly periods on 9 November, the last ending at maturity. */
const yearly = (isin: string, rate?: number): InterestPeriod[] =>
  [2025, 2026, 2027, 2028].map((y) => ({ isin, start: `${y}-11-09`, end: `${y + 1}-11-09`, paymentDate: `${y + 1}-11-09`, datesSource: "obligacje.pl" as const, ...(rate !== undefined ? { rate, rateSource: "obligacje.pl" as const } : {}) }));
const terms = (b: CatalystBondItem, coupon: CatalystTermsItem["coupon"]): CatalystTermsItem => ({ ...catalystKeys.terms(b.isin), GSI1PK: "TERMS", GSI1SK: b.isin, isin: b.isin, code: b.code, coupon, source: "t", fetchedAt: "" });
const input = (over: Partial<ScreenInput> & Pick<ScreenInput, "bond">): ScreenInput => ({
  coupons: [],
  sessions: [],
  quotes: [],
  fixedCurve: [{ years: 3, value: 0.05, code: "PS" }],
  wzCurve: [{ years: 3, value: 0.002, code: "WZ" }],
  offers: [],
  assumptions: { ...DEFAULT_CATALYST_ASSUMPTIONS, commission: 0 },
  ...over,
});

describe("screenRow", () => {
  it("a fixed 6 % bond at par: yields 6 % before tax and 6 % × 0,81 after; its premium over a 5 % curve", () => {
    const b = bond({ code: "FIX1129" });
    const r = screenRow(input({ bond: b, terms: terms(b, { kind: "FIXED", rate: 0.06 }), coupons: yearly(b.isin, 0.06), sessions: sessions(b, 100) }));
    expect(r.yieldGross).toBeCloseTo(0.06, 2);
    expect(r.yieldNet).toBeCloseTo(0.06 * 0.81, 2);
    expect(r.premium).toBeCloseTo(0.01, 2);
    expect(r.premiumBasis).toBe("fixed-curve");
    expect(r).toMatchObject({ price: 100, market: "GPW ASO", projected: false, flags: [] });
    expect(r.liquidity.level).toBe("medium");
  });

  it("a floating bond: coupons at the assumed WIBOR + margin; premium = margin adjusted for price − WZ's", () => {
    const b = bond({ code: "FLO1129" });
    const r = screenRow(input({ bond: b, terms: terms(b, { kind: "FLOATING", base: "WIBOR 6M", margin: 0.03 }), coupons: yearly(b.isin), sessions: sessions(b, 101), assumptions: { ...DEFAULT_CATALYST_ASSUMPTIONS, wibor: 0.045, commission: 0 } }));
    expect(r.projected).toBe(true);
    expect(r.yieldGross).toBeGreaterThan(0.07);
    expect(r.yieldGross).toBeLessThan(0.075);
    expect(r.premium).toBeCloseTo(0.03 - 0.01 / (r.years ?? 1) - 0.002, 4);
    expect(r.premiumBasis).toBe("wz");
  });

  it("a treasury DS bond's yield comes from the file's rate, yearly to maturity", () => {
    const b = bond({ code: "DS1129", segment: "treasury", markets: ["BS RR", "GPW RR"] });
    const s = [...sessions({ ...b, markets: ["GPW RR"] }, 100), ...sessions({ ...b, markets: ["BS RR"] }, 90)];
    const r = screenRow(input({ bond: b, sessions: s }));
    expect(r.market).toBe("GPW RR");
    expect(r.price).toBe(100);
    expect(r.yieldGross).toBeCloseTo(0.06, 2);
  });

  it("no terms, stale, maturing soon: flagged, no yield where it would mislead", () => {
    const untermed = bond({ code: "NOT1129" });
    expect(screenRow(input({ bond: untermed, sessions: sessions(untermed, 100) }))).toMatchObject({ yieldNet: null, flags: ["no-terms"] });
    const stale = bond({ code: "STL1129" });
    const r = screenRow(input({ bond: stale, terms: terms(stale, { kind: "FIXED", rate: 0.06 }), coupons: yearly(stale.isin, 0.06), sessions: sessions(stale, 100, () => 0) }));
    expect(r.flags).toContain("stale");
    expect(r.premium).toBeNull();
    expect(r.yieldNet).not.toBeNull();
    const soon = bond({ code: "SON1226", maturity: "2026-12-20" });
    expect(screenRow(input({ bond: soon, sessions: sessions(soon, 100) }))).toMatchObject({ yieldNet: null, flags: ["matures-soon"] });
  });

  it("periods listed only up to the current one are extended to maturity (the last period's length), flagged", () => {
    const b = bond({ code: "EXT1129" });
    const short = yearly(b.isin).slice(0, 2); // to 2027-11-09; the bond matures 2029-11-09
    const r = screenRow(input({ bond: b, terms: terms(b, { kind: "FIXED", rate: 0.06 }), coupons: short, sessions: sessions(b, 100) }));
    expect(r.flags).toContain("periods-extended");
    expect(r.yieldGross).toBeCloseTo(0.06, 2);
    expect(r.projected).toBe(true);
  });

  it("a bond listed under 10 sessions ago is flagged new (its liquidity rests on a few days)", () => {
    const b = bond({ code: "NEW1129", firstSeen: "2026-11-04" });
    const recent = sessions(b, 100, () => 1).slice(-2);
    expect(screenRow(input({ bond: b, sessions: recent })).flags).toContain("new-listing");
    expect(screenRow(input({ bond: b, sessions: sessions(b, 100) })).flags).not.toContain("new-listing");
  });

  it("an amortising bond (nominal below the issue's) is flagged", () => {
    const b = bond({ code: "AMO1129", nominal: 550 });
    const t = { ...terms(b, { kind: "FIXED" as const, rate: 0.06 }), issueValue: { amount: 1e8, currency: "PLN", nominal: 1000 } };
    expect(screenRow(input({ bond: b, terms: t, coupons: yearly(b.isin, 0.06), sessions: sessions(b, 100) })).flags).toContain("amortising");
  });
});
