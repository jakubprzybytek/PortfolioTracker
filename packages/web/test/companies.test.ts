import { describe, expect, it } from "vitest";
import { companyList, companyParam, inList, matches, toggleCompany } from "../src/catalyst/filters.ts";
import type { BondRow } from "../src/catalyst/types.ts";

const row = (over: Partial<BondRow>): BondRow => ({ isin: "PL1", code: "X", segment: "corporate", currency: "PLN", markets: [], maturity: null, nominal: 1000, date: "2026-11-05", market: "GPW", price: 100, lastTraded: null, accruedInterest: null, years: 2, yieldGross: null, yieldNet: null, projected: false, alternative: null, vsAlternative: null, premium: null, premiumBasis: null, liquidity: { level: "high", traded30: 1, traded90: 1, medianTurnover30: null, trades30: 1, medianSpread30: null, bid: null, daysToSell10k: null }, flags: [], ...over });
const kruk = row({ entityId: "0000533217", issuerShort: "Kruk" });
const vehicle = row({ entityId: "0000000009", issuerShort: "PEU FIN", groupId: "0000000008", groupShort: "Pepco" });
const unlinked = row({ issuer: "Abc, S.A." });

describe("the view's companies", () => {
  it("round-trips names with commas through the URL value", () => {
    const list = ["0000533217", "n:Abc, S.A."];
    expect(companyList({ co: companyParam(list) })).toEqual(list);
    expect(companyParam([])).toBeUndefined();
  });

  it("only these: their bonds; all except these: the rest", () => {
    const p = { co: "0000533217" };
    expect([kruk, vehicle].map((r) => matches(r, p))).toEqual([true, false]);
    expect([kruk, vehicle].map((r) => matches(r, { ...p, cm: "out" }))).toEqual([false, true]);
    // No list: the mode does nothing.
    expect(matches(kruk, { cm: "out" })).toBe(true);
  });

  it("adds a vehicle under its group, so the group's other vehicles count too; takes it off by any key", () => {
    expect(toggleCompany(vehicle, [])).toEqual(["0000000008"]);
    expect(inList(row({ entityId: "0000000010", groupId: "0000000008" }), ["0000000008"])).toBe(true);
    // A list from the issuer dialog (the vehicle's own id) still matches and comes off.
    expect(toggleCompany(vehicle, ["0000000009", "0000533217"])).toEqual(["0000533217"]);
  });

  it("a bond not linked yet goes by its listed name", () => {
    expect(toggleCompany(unlinked, [])).toEqual(["n:Abc, S.A."]);
    expect(matches(unlinked, { co: companyParam(["n:Abc, S.A."])! })).toBe(true);
  });
});
