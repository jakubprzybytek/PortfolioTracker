import { describe, expect, it } from "vitest";
import { catalystKeys, type CatalystBondItem, type CatalystTermsItem } from "../src/catalyst/items.ts";
import { currentPeriodStart, parseCoupon, termsWork } from "../src/catalyst/terms.ts";

describe("parseCoupon", () => {
  it("reads floating, fixed and zero-coupon terms as obligacje.pl writes them", () => {
    expect(parseCoupon("zmienne WIBOR 3M + 3.3%")).toEqual({ kind: "FLOATING", base: "WIBOR 3M", margin: 0.033 });
    expect(parseCoupon("zmienne WIBOR 6M +  1,85%")).toEqual({ kind: "FLOATING", base: "WIBOR 6M", margin: 0.0185 });
    expect(parseCoupon("zmienne WIRON 1M + 1.5%")).toEqual({ kind: "FLOATING", base: "WIRON 1M", margin: 0.015 });
    expect(parseCoupon("zmienne POLSTR 6M + 0%")).toEqual({ kind: "FLOATING", base: "POLSTR 6M", margin: 0 });
    expect(parseCoupon("zmienne EURIBOR 6M + 4%")).toEqual({ kind: "FLOATING", base: "EURIBOR 6M", margin: 0.04 });
    expect(parseCoupon("zmienne WIBOR 6M")).toEqual({ kind: "FLOATING", base: "WIBOR 6M", margin: 0 });
    expect(parseCoupon("stałe 7.5%")).toEqual({ kind: "FIXED", rate: 0.075 });
    expect(parseCoupon("stałe 1,75%")).toEqual({ kind: "FIXED", rate: 0.0175 });
    expect(parseCoupon("zerokuponowe")).toEqual({ kind: "ZERO" });
    expect(parseCoupon("indeksowane inflacją")).toEqual({ kind: "OTHER" });
  });
});

const bond = (code: string, segment: CatalystBondItem["segment"], status: CatalystBondItem["status"] = "listed"): CatalystBondItem => ({
  ...catalystKeys.bond(`PL${code}`),
  GSI1PK: "BOND",
  GSI1SK: code,
  isin: `PL${code}`,
  code,
  segment,
  currency: "PLN",
  markets: ["GPW ASO"],
  maturity: "2030-01-01",
  nominal: 1000,
  status,
  firstSeen: "2026-01-02",
  lastSeen: "2026-11-05",
  updatedAt: "",
});
const terms = (b: CatalystBondItem, t: Partial<CatalystTermsItem>): CatalystTermsItem => ({ ...catalystKeys.terms(b.isin), GSI1PK: "TERMS", GSI1SK: b.isin, isin: b.isin, code: b.code, coupon: { kind: "FIXED", rate: 0.07 }, source: "obligacje.pl", fetchedAt: "2026-11-01T09:30:00Z", ...t });

describe("termsWork", () => {
  const corp = bond("KRU0829", "corporate");
  const muni = bond("WAW0130", "municipal");
  const ds = bond("DS0432", "treasury");
  const wz = bond("WZ0330", "treasury");
  const ended = bond("ABC0124", "corporate", "ended");

  it("listed bonds without terms, corporate first, municipal last; treasury only its floating series; ended corporate ones last", () => {
    expect(termsWork([muni, ds, ended, wz, corp], new Map(), "2026-11-06", 10).map((b) => b.code)).toEqual(["KRU0829", "WZ0330", "WAW0130", "ABC0124"]);
    expect(termsWork([muni, corp], new Map(), "2026-11-06", 1).map((b) => b.code)).toEqual(["KRU0829"]);
  });

  it("an ended bond once: not when it has terms, not again when the site didn't have it; only corporate PLN", () => {
    expect(termsWork([ended], new Map([[ended.isin, terms(ended, {})]]), "2026-11-06", 10)).toEqual([]);
    expect(termsWork([ended], new Map([[ended.isin, terms(ended, { notFound: true, fetchedAt: "2026-01-01T09:30:00Z" })]]), "2026-11-06", 10)).toEqual([]);
    expect(termsWork([bond("WAW0124", "municipal", "ended"), { ...bond("ABC0125", "corporate", "ended"), currency: "EUR" }], new Map(), "2026-11-06", 10)).toEqual([]);
  });

  it("then floating bonds a week into a new period, read before it; and codes the site didn't have a month ago", () => {
    const floatingDue = terms(corp, { coupon: { kind: "FLOATING", base: "WIBOR 3M", margin: 0.03 }, currentPeriodStart: "2026-10-28", fetchedAt: "2026-10-20T09:30:00Z" });
    expect(termsWork([corp], new Map([[corp.isin, floatingDue]]), "2026-11-06", 10)).toEqual([corp]);
    expect(termsWork([corp], new Map([[corp.isin, { ...floatingDue, fetchedAt: "2026-11-05T09:30:00Z" }]]), "2026-11-06", 10)).toEqual([]); // read after the week
    expect(termsWork([corp], new Map([[corp.isin, { ...floatingDue, currentPeriodStart: "2026-11-02" }]]), "2026-11-06", 10)).toEqual([]); // not a week yet
    const fixed = terms(muni, {});
    expect(termsWork([muni], new Map([[muni.isin, fixed]]), "2026-11-06", 10)).toEqual([]);
    const gone = terms(muni, { notFound: true, fetchedAt: "2026-10-01T09:30:00Z" });
    expect(termsWork([muni], new Map([[muni.isin, gone]]), "2026-11-06", 10)).toEqual([muni]);
    expect(termsWork([muni], new Map([[muni.isin, { ...gone, fetchedAt: "2026-10-20T09:30:00Z" }]]), "2026-11-06", 10)).toEqual([]);
    const badDates = terms(muni, { periodsProblem: "12 period starts, 13 record days", fetchedAt: "2026-10-01T09:30:00Z" });
    expect(termsWork([muni], new Map([[muni.isin, badDates]]), "2026-11-06", 10)).toEqual([muni]);
    expect(termsWork([muni], new Map([[muni.isin, { ...badDates, fetchedAt: "2026-10-20T09:30:00Z" }]]), "2026-11-06", 10)).toEqual([]);
  });
});

describe("currentPeriodStart", () => {
  it("the period running on the day", () => {
    const periods = [
      { start: "2026-05-12", end: "2026-08-12" },
      { start: "2026-08-12", end: "2026-11-12" },
    ];
    expect(currentPeriodStart(periods, "2026-11-06")).toBe("2026-08-12");
    expect(currentPeriodStart(periods, "2026-11-12")).toBeUndefined();
  });
});
