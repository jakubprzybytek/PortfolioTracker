import { describe, expect, it } from "vitest";
import { isQuoted, isTradingDay, issueKey, priceIssues } from "../src/quality/quality.ts";

const etf = { isin: "IE00TEST0001", code: "ETF1", venue: "XETR", type: "ETF" as const };
const bond = { isin: "PL0000000001", code: "DS0432", venue: "XWAR", type: "BOND_LISTED" as const };
const corp = { isin: "PL0000000002", code: "KRU0827", venue: "CATALYST", type: "BOND_CORPORATE" as const };
const days = (from: string, to: string, skip: string[] = [], venue = "XETR") => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const s = d.toISOString().slice(0, 10);
    if (isTradingDay(venue, s) && !skip.includes(s)) out.push(s);
  }
  return out;
};
const flat = (dates: string[], close = 100) => dates.map((date) => ({ date, close }));

describe("trading days", () => {
  it("knows the Warsaw holidays and the usual EU exchange holidays", () => {
    expect(isTradingDay("XWAR", "2026-11-11")).toBe(false); // Independence Day
    expect(isTradingDay("XETR", "2026-11-11")).toBe(true);
    expect(isTradingDay("XETR", "2026-04-03")).toBe(false); // Good Friday
    expect(isTradingDay("XAMS", "2026-12-24")).toBe(false);
    expect(isTradingDay("XETR", "2026-10-24")).toBe(false); // Saturday
  });
  it("checks only instruments priced from a source", () => {
    expect(isQuoted(etf)).toBe(true);
    expect(isQuoted({ venue: "CALC", type: "BOND_RETAIL" })).toBe(false);
    expect(isQuoted({ venue: "MANUAL", type: "FUND_MANUAL" })).toBe(false);
  });
});

describe("priceIssues", () => {
  it("finds runs of trading days without a price; a short run at the end isn't an issue yet, a long one is stale", () => {
    const prices = flat(days("2026-09-01", "2026-10-22", ["2026-09-15", "2026-09-16", "2026-10-21", "2026-10-22"]));
    const issues = priceIssues(etf, prices, "2026-09-01", "2026-10-22");
    expect(issues).toEqual([{ kind: "gap", isin: etf.isin, code: "ETF1", date: "2026-09-15", to: "2026-09-16", detail: "no price 2026-09-15 – 2026-09-16 (2 trading days)" }]);
    const stale = priceIssues(etf, flat(days("2026-09-01", "2026-10-16")), "2026-09-01", "2026-10-22");
    expect(stale.map((i) => [i.kind, i.date])).toEqual([["stale", "2026-10-19"]]);
  });

  it("Catalyst: a bond that didn't trade has no price; only 10 trading days without one count", () => {
    const nine = flat(days("2026-09-01", "2026-10-22", days("2026-09-07", "2026-09-17", [], "CATALYST"), "CATALYST"));
    expect(priceIssues(corp, nine, "2026-09-01", "2026-10-22")).toEqual([]);
    const ten = flat(days("2026-09-01", "2026-10-22", days("2026-09-07", "2026-09-18", [], "CATALYST"), "CATALYST"));
    expect(priceIssues(corp, ten, "2026-09-01", "2026-10-22").map((i) => i.kind)).toEqual(["gap"]);
  });

  it("flags jumps (ETFs over 20 %, after splits; bonds over 5 %) and bond prices out of 50–150 %", () => {
    const d = days("2026-10-01", "2026-10-09");
    const etfPrices = d.map((date, i) => ({ date, close: i < 3 ? 100 : 130 }));
    expect(priceIssues(etf, etfPrices, d[0]!, d.at(-1)!).map((i) => [i.kind, i.date])).toEqual([["jump", d[3]]]);
    // A recorded 100:1 split is no jump
    const split = d.map((date, i) => ({ date, close: i < 3 ? 1000 : 10 }));
    expect(priceIssues({ ...etf, splits: [{ date: d[3]!, ratio: 100 }] }, split, d[0]!, d.at(-1)!)).toEqual([]);
    const bd = days("2026-10-01", "2026-10-09", [], "XWAR");
    const bondPrices = bd.map((date, i) => ({ date, close: i === 4 ? 40 : 98 }));
    const kinds = priceIssues(bond, bondPrices, bd[0]!, bd.at(-1)!).map((i) => i.kind);
    expect(kinds.sort()).toEqual(["jump", "jump", "range"]);
  });

  it("keys issues by kind, instrument and day", () => {
    expect(issueKey({ kind: "gap", isin: "X", code: "C", date: "2026-01-02", detail: "" })).toBe("gap|X|2026-01-02");
  });
});
