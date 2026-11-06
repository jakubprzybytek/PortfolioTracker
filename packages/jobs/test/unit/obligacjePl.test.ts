import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBondPage } from "../../src/lib/obligacjePl.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("obligacje.pl", () => {
  it("reads a bond's terms: nominal, coupon type, current rate and the periods' dates", () => {
    const bond = parseBondPage(fixture("obligacje-KRU0827.html"));
    expect(bond).toMatchObject({ isin: "PLKRK0000713", nominal: 100, currency: "PLN", couponType: "zmienne WIBOR 3M + 3.3%", currentRate: 0.0713, fixedRate: null });
    expect(bond).toMatchObject({ issuer: "Kruk S.A.", series: "AM4", issueValue: { amount: 60_000_000, currency: "PLN" }, secured: false });
    expect(bond.periods).toHaveLength(20);
    expect(bond.periods[0]).toEqual({ start: "2022-08-12", end: "2022-11-12", recordDate: "2022-11-03", paymentDate: "2022-11-12" });
    // The last period ends on its payment day (the next start isn't listed).
    expect(bond.periods.at(-1)).toEqual({ start: "2027-05-12", end: "2027-08-12", recordDate: "2027-08-04", paymentDate: "2027-08-12" });
  });

  it("leaves out record days that don't fit their period", () => {
    const bond = parseBondPage(fixture("obligacje-PLY1227.html"));
    expect(bond).toMatchObject({ isin: "PLO266100034", nominal: 1000, currentRate: 0.0576 });
    expect(bond.periods.slice(-3)).toEqual([
      { start: "2026-06-29", end: "2026-12-29", recordDate: "2026-12-21", paymentDate: "2026-12-29" },
      // The site lists 2026-12-21 and 2027-06-21 here: a period early.
      { start: "2026-12-29", end: "2027-06-29", paymentDate: "2027-06-29" },
      { start: "2027-06-29", end: "2027-12-29", paymentDate: "2027-12-29" },
    ]);
  });

  it("lenient: a page whose date lists don't add up keeps its other terms, without periods", () => {
    const broken = fixture("obligacje-KRU0827.html").replace(/(<h4>\s*Dni wypłaty odsetek\s*<\/h4>\s*<div class="txt">[\s\S]*?)<li>[^<]*<\/li>/, "$1");
    expect(() => parseBondPage(broken)).toThrow(/20 period starts, 20 record days, 19 payment days/);
    const bond = parseBondPage(broken, { lenient: true });
    expect(bond).toMatchObject({ isin: "PLKRK0000713", issuer: "Kruk S.A.", couponType: "zmienne WIBOR 3M + 3.3%", periods: [], periodsProblem: "20 period starts, 20 record days, 19 payment days" });
  });

  it("refuses a page without an ISIN", () => {
    expect(() => parseBondPage("<html></html>")).toThrow(/no ISIN/);
  });
});
