import { describe, expect, it } from "vitest";
import type { InterestPeriod } from "../src/bonds/couponPeriods.ts";
import { catalystKeys, type CatalystBondItem, type CatalystSessionItem, type CatalystTermsItem } from "../src/catalyst/items.ts";
import { CARRY_SESSIONS, MIN_GROUP, premiumIndex, premiumMoves, premiumSeries, type BondPremiums } from "../src/catalyst/premiums.ts";
import { DEFAULT_CATALYST_ASSUMPTIONS, screenRow, sessionPremium } from "../src/catalyst/screen.ts";

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
const yearly = (isin: string, rate?: number): InterestPeriod[] =>
  [2025, 2026, 2027, 2028].map((y) => ({ isin, start: `${y}-11-09`, end: `${y + 1}-11-09`, paymentDate: `${y + 1}-11-09`, datesSource: "obligacje.pl" as const, ...(rate !== undefined ? { rate, rateSource: "obligacje.pl" as const } : {}) }));
const terms = (b: CatalystBondItem, coupon: CatalystTermsItem["coupon"]): CatalystTermsItem => ({ ...catalystKeys.terms(b.isin), GSI1PK: "TERMS", GSI1SK: b.isin, isin: b.isin, code: b.code, coupon, source: "t", fetchedAt: "" });
const session = (b: CatalystBondItem, close: number, date = DATE) => ({ date, close, accruedInterest: 0, nominal: b.nominal, rate: 0.06 });
const fixedCurve = [{ years: 3, value: 0.05, code: "PS" }];
const wzCurve = [{ years: 3, value: 0.002, code: "WZ" }];

describe("sessionPremium", () => {
  const fix = bond({ code: "FIX1129" });
  const flo = bond({ code: "FLO1129" });
  const fixTerms = terms(fix, { kind: "FIXED", rate: 0.06 });
  const floTerms = terms(flo, { kind: "FLOATING", base: "WIBOR 6M", margin: 0.03 });

  it("the same as the screen's premium on its last session, fixed and floating", () => {
    for (const [b, t, coupons, close] of [
      [fix, fixTerms, yearly(fix.isin, 0.06), 100],
      [flo, floTerms, yearly(flo.isin), 101],
    ] as const) {
      const s = { ...catalystKeys.session(b.isin, DATE, "GPW ASO"), isin: b.isin, date: DATE, market: "GPW ASO", rate: 0.06, accruedInterest: 0, nominal: 1000, close, reference: close, open: null, low: null, high: null, last: null, trades: 1, volume: 0, turnover: 20_000, blockVolume: 0, blockTurnover: 0, source: "t", fetchedAt: "" } as CatalystSessionItem;
      const row = screenRow({ bond: b, terms: t, coupons: [...coupons], sessions: [s], quotes: [], fixedCurve, wzCurve, offers: [], assumptions: { ...DEFAULT_CATALYST_ASSUMPTIONS, commission: 0 } });
      const p = sessionPremium({ bond: b, terms: t, coupons: [...coupons], session: session(b, close), fixedCurve, wzCurve });
      expect(p).toEqual({ premium: row.premium, basis: row.premiumBasis });
    }
  });

  it("a floating bond: its margin adjusted for the price, less WZ's; a fixed one: its yield less the curve", () => {
    expect(sessionPremium({ bond: flo, terms: floTerms, coupons: yearly(flo.isin), session: session(flo, 100), fixedCurve, wzCurve })!.premium).toBeCloseTo(0.03 - 0.002, 6);
    expect(sessionPremium({ bond: fix, terms: fixTerms, coupons: yearly(fix.isin, 0.06), session: session(fix, 100), fixedCurve, wzCurve })!.premium).toBeCloseTo(0.01, 2);
    // Cheaper, a wider premium.
    expect(sessionPremium({ bond: flo, terms: floTerms, coupons: [], session: session(flo, 95), fixedCurve, wzCurve })!.premium).toBeGreaterThan(0.04);
  });

  it("none: another currency, within 90 days of maturity, no terms, indexed, no price", () => {
    expect(sessionPremium({ bond: { ...flo, currency: "EUR" }, terms: floTerms, coupons: [], session: session(flo, 100), fixedCurve, wzCurve })).toBeNull();
    expect(sessionPremium({ bond: { ...flo, maturity: "2027-01-15" }, terms: floTerms, coupons: [], session: session(flo, 100), fixedCurve, wzCurve })).toBeNull();
    expect(sessionPremium({ bond: fix, coupons: [], session: session(fix, 100), fixedCurve, wzCurve })).toBeNull();
    expect(sessionPremium({ bond: bond({ code: "IZ0836", segment: "treasury" }), coupons: [], session: session(fix, 100), fixedCurve, wzCurve })).toBeNull();
    expect(sessionPremium({ bond: flo, terms: floTerms, coupons: [], session: { ...session(flo, 100), close: null }, fixedCurve, wzCurve })).toBeNull();
  });

  it("an earlier session: its own years to maturity (a past date gives a longer bond)", () => {
    const now = sessionPremium({ bond: flo, terms: floTerms, coupons: [], session: session(flo, 95), fixedCurve, wzCurve })!.premium;
    const then = sessionPremium({ bond: flo, terms: floTerms, coupons: [], session: session(flo, 95, "2024-11-05"), fixedCurve, wzCurve })!.premium;
    // The same discount spread over more years: a smaller premium.
    expect(then).toBeLessThan(now);
  });
});

describe("premiumIndex", () => {
  const sessions = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const floating = (isin: string, points: Record<string, number>): BondPremiums => ({ isin, basis: "wz", points });

  it("per session: the median and quartiles of the bonds' latest premiums; a group of fewer than five left out", () => {
    const bonds = [1, 2, 3, 4, 5].map((k) => floating(`B${k}`, { "2026-10-01": k / 100 }));
    const [first] = premiumIndex(sessions, bonds, () => "Finance");
    expect(first!.all).toEqual({ median: 0.03, q1: 0.02, q3: 0.04, n: 5 });
    expect(first!.floating).toEqual(first!.all);
    expect(first!.fixed).toBeUndefined();
    expect(first!.industry["Finance"]).toEqual(first!.all);
    expect(premiumIndex(sessions, bonds.slice(0, MIN_GROUP - 1), () => undefined)[0]!.all).toBeUndefined();
  });

  it(`a bond counts for ${CARRY_SESSIONS} sessions from its trade, or until its next one`, () => {
    const bonds = [1, 2, 3, 4].map((k) => floating(`B${k}`, { "2026-10-01": 0.02 }));
    const index = premiumIndex(sessions, [...bonds, floating("T", { "2026-10-01": 0.1, "2026-10-05": 0.2 })], () => undefined);
    expect(index[0]!.all!.n).toBe(5);
    // The fifth bond's second trade replaces its first, not added to it.
    expect(index[4]!.all!.n).toBe(5);
    expect(index[4]!.all!.q3).toBe(0.02);
    // The four bonds' trade is CARRY_SESSIONS old on the 11th: out; the median group falls below five.
    expect(index[CARRY_SESSIONS - 1]!.all).toBeDefined();
    expect(index[CARRY_SESSIONS]!.all).toBeUndefined();
  });

  it("by industry and coupon type; a bond without a company only in the totals; dates outside the sessions ignored", () => {
    const bonds = [
      ...[1, 2, 3, 4, 5].map((k) => floating(`D${k}`, { "2026-10-02": 0.05 })),
      ...[1, 2, 3, 4, 5].map((k): BondPremiums => ({ isin: `F${k}`, basis: "fixed-curve", points: { "2026-10-02": 0.01, "2026-11-30": 0.9 } })),
      floating("X", { "2026-10-02": 0.2 }),
    ];
    const index = premiumIndex(sessions, bonds, (isin) => (isin.startsWith("D") ? "Developer" : isin.startsWith("F") ? "Finance" : undefined));
    const day = index[1]!;
    expect(day.all!.n).toBe(11);
    expect(day.floating!.n).toBe(6);
    expect(day.fixed!.median).toBe(0.01);
    expect(Object.keys(day.industry).sort()).toEqual(["Developer", "Finance"]);
    expect(day.industry["Developer"]!.median).toBe(0.05);
    expect(index[0]!.all).toBeUndefined();
  });
});

describe("premiumSeries and premiumMoves", () => {
  const sessions = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const h = (isin: string, points: Record<string, number>): BondPremiums => ({ isin, basis: "wz", points });
  /** An index whose sector and market medians go from `from` to `to` over the sessions. */
  const index = (sector: [number, number], market: [number, number]) =>
    sessions.map((date, i) => {
      const r = (x: number) => Math.round(x * 1e6) / 1e6;
      const at = ([a, b]: [number, number]) => r(a + ((b - a) * i) / (sessions.length - 1));
      return { date, all: { median: at(market), q1: r(at(market) - 0.01), q3: r(at(market) + 0.01), n: 100 }, industry: { Developer: { median: at(sector), q1: r(at(sector) - 0.01), q3: r(at(sector) + 0.01), n: 20 } } };
    });
  const moves = (bond: BondPremiums, others: BondPremiums[], idx: ReturnType<typeof index>) => premiumMoves(premiumSeries(sessions, bond, others, idx, "Developer"));

  it("the series: the bond's own premium on its traded sessions; the issuer's other bonds' median; the sector's and market's bands", () => {
    const s = premiumSeries(sessions, h("A", { "2026-10-01": 0.05 }), [h("B", { "2026-10-01": 0.06 }), h("C", { "2026-10-01": 0.08 })], index([0.04, 0.04], [0.03, 0.03]), "Developer");
    expect(s[0]).toEqual({ date: "2026-10-01", bond: 0.05, issuer: 0.07, sector: { median: 0.04, q1: 0.03, q3: 0.05 }, market: { median: 0.03, q1: 0.02, q3: 0.04 } });
    expect(s[1]!.bond).toBeNull();
    // The other bonds' trades count for ten sessions, then the issuer's line stops.
    expect(s[CARRY_SESSIONS - 1]!.issuer).toBe(0.07);
    expect(s[CARRY_SESSIONS]!.issuer).toBeUndefined();
    // Without an industry: no sector band.
    expect(premiumSeries(sessions, undefined, [], index([0.04, 0.04], [0.03, 0.03]), undefined)[0]!.sector).toBeUndefined();
  });

  it("the market's move: the sector widened about as much as the bond", () => {
    const m = moves(h("A", { "2026-10-01": 0.04, "2026-10-20": 0.06 }), [], index([0.04, 0.055], [0.03, 0.04]));
    expect(m).toMatchObject({ bond: 0.02, sector: 0.015, market: 0.01, verdict: "sector" });
  });

  it("the issuer's: its other bonds widened with it, the sector didn't", () => {
    const others = [h("B", { "2026-10-01": 0.05, "2026-10-20": 0.09 })];
    // A third of the bond's move will do (a bond near maturity moves several times as much): GHE0327, 2026.
    expect(moves(h("A", { "2026-10-01": 0.2, "2026-10-20": 0.63 }), [h("B", { "2026-10-01": 0.15, "2026-10-20": 0.36 })], index([0.04, 0.037], [0.03, 0.03])).verdict).toBe("issuer");
    expect(moves(h("A", { "2026-10-01": 0.05, "2026-10-20": 0.1 }), others, index([0.04, 0.04], [0.03, 0.03])).verdict).toBe("issuer");
    // No other bonds: the issuer's all the same.
    expect(moves(h("A", { "2026-10-01": 0.05, "2026-10-20": 0.1 }), [], index([0.04, 0.04], [0.03, 0.03])).verdict).toBe("issuer");
  });

  it("this bond's alone: its issuer's other bonds stayed", () => {
    const others = [h("B", { "2026-10-01": 0.05, "2026-10-12": 0.05, "2026-10-20": 0.051 })];
    expect(moves(h("A", { "2026-10-01": 0.05, "2026-10-20": 0.1 }), others, index([0.04, 0.04], [0.03, 0.03])).verdict).toBe("bond");
  });

  it("every change over the bond's own trades: a bond first traded halfway isn't compared with the sector before", () => {
    // The sector widens in the first half only; the bond trades in the second half, flat.
    const idx = sessions.map((date, i) => ({ date, all: { median: 0.03, q1: 0.02, q3: 0.04, n: 100 }, industry: { Developer: { median: i < 10 ? 0.03 + i * 0.002 : 0.05, q1: 0.02, q3: 0.06, n: 20 } } }));
    const m = moves(h("A", { "2026-10-11": 0.05, "2026-10-20": 0.051 }), [], idx);
    expect(m).toMatchObject({ from: "2026-10-11", to: "2026-10-20", sector: 0, verdict: "unchanged" });
  });

  it("unchanged under a quarter point; nothing to say with fewer than two trades", () => {
    expect(moves(h("A", { "2026-10-01": 0.05, "2026-10-20": 0.052 }), [], index([0.04, 0.06], [0.03, 0.03])).verdict).toBe("unchanged");
    expect(moves(h("A", { "2026-10-01": 0.05 }), [], index([0.04, 0.06], [0.03, 0.03]))).toMatchObject({ bond: null, verdict: null });
  });
});
