import { beforeAll, describe, expect, it } from "vitest";
import { grosz, lotSeries, publishedRatePeriods, valueRetailBond } from "../src/bonds/retail.ts";
import { parseRetailRates, parseTerm, type RetailTerms } from "../src/mf/retailRates.ts";
import { FIXTURES, fixture } from "./fixtures.ts";

let all: Map<string, RetailTerms>;
beforeAll(() => {
  all = parseRetailRates(fixture(FIXTURES.mfRetail));
});

describe("parseRetailRates (Ministry file, October 2026)", () => {
  it("reads every kind with ISIN, term, rates, margin and rollover price", () => {
    expect(all.size).toBeGreaterThan(900);
    expect(all.get("EDO0332")).toMatchObject({ isin: "PL0000114518", kind: "EDO", termMonths: 120, periodMonths: 12, capitalises: true, margin: 0.0125, rolloverPrice: 99.9, saleStart: "2022-03-01", saleEnd: "2022-03-31" });
    expect(all.get("EDO0332")!.rates).toEqual([0.022, 0.1845, 0.0515, 0.0655, 0.0345, null, null, null, null, null]);
    expect(all.get("COI1126")).toMatchObject({ kind: "COI", termMonths: 48, capitalises: false, rates: [0.07, 0.092, 0.059, 0.039], publishedInterest: [7, 9.2, 5.9, 3.9], margin: 0.01 });
    expect(all.get("TOS0926")).toMatchObject({ kind: "TOS", termMonths: 36, rates: [0.0685, 0.0685, 0.0685], publishedInterest: [21.99] });
    expect(all.get("TOS0926")!.margin).toBeUndefined();
    expect(all.get("ROD0937")).toMatchObject({ kind: "ROD", termMonths: 144, rates: [0.0625, 0.055, ...Array(10).fill(null)], margin: 0.025 }); // year 2 started 2026-09
    expect(all.get("ROR0623")).toMatchObject({ kind: "ROR", termMonths: 12, periodMonths: 1, capitalises: false });
    expect(all.get("ROR0623")!.rates).toHaveLength(12);
    expect(parseTerm("13  miesięcy od dnia zakupu")).toBe(13);
  });
});

describe("retail bond value vs the interest the Ministry published", () => {
  const complete = (t: RetailTerms) => t.rates.every((r) => r !== null);

  it("capitalising series (EDO, ROS, TOS): total interest at maturity matches to the grosz", () => {
    const checked = [...all.values()].filter((t) => t.capitalises && complete(t) && t.publishedInterest[0] != null);
    expect(checked.length).toBeGreaterThan(250);
    const wrong = checked.filter((t) => {
      const lot = lotSeries(t, t.saleStart);
      const v = valueRetailBond(lot, publishedRatePeriods(lot, t.rates), lot.maturity);
      return grosz(v.value - 100) !== t.publishedInterest[0];
    });
    expect(wrong.map((t) => t.series)).toEqual([]);
  });

  it("payout series (COI, ROR, DOR): every period's payout matches to the grosz", () => {
    const checked = [...all.values()].filter((t) => !t.capitalises && t.publishedInterest.filter((x) => x !== null).length > 1);
    expect(checked.length).toBeGreaterThan(300);
    const wrong = checked.filter((t) => {
      const lot = lotSeries(t, t.saleStart);
      const periods = publishedRatePeriods(lot, t.rates);
      return periods.some((p, i) => {
        const published = t.publishedInterest[i];
        if (published == null || t.rates[i] == null) return false;
        const paidBefore = valueRetailBond(lot, periods, p.start).paidOut;
        return grosz(valueRetailBond(lot, periods, p.end).paidOut - paidBefore) !== published;
      });
    });
    expect(wrong.map((t) => t.series)).toEqual([]);
  });

  it("accrues within the year and keeps the last rate, flagged, where none is published yet", () => {
    const t = all.get("EDO0936")!; // bought 2026-09, only year 1 known
    const lot = lotSeries(t, "2026-09-14");
    const periods = publishedRatePeriods(lot, t.rates);
    expect(valueRetailBond(lot, periods, "2026-09-14").value).toBe(100);
    expect(valueRetailBond(lot, periods, "2027-03-14").value).toBeCloseTo(100 + 5.35 * (181 / 365), 2);
    expect(valueRetailBond(lot, periods, "2027-10-01")).toMatchObject({ problem: "unknown_rate" });
  });
});
