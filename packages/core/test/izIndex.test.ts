import { beforeAll, describe, expect, it } from "vitest";
import { parseMfCalculator, type MfCalculatorData } from "../src/mf/calculator.ts";
import { indexRatioAt, referenceIndexAt, referenceIndexCoverageEnd, toReferenceIndex, type ReferenceIndex } from "../src/bonds/izIndex.ts";
import { valueBond, dirtyValue } from "../src/bonds/accrued.ts";
import type { BondTerms } from "../src/bonds/terms.ts";
import { FIXTURES, fixture } from "./fixtures.ts";

// Published by the Ministry of Finance at gov.pl/web/finanse/wspolczynniki-indeksacji2 (read 2026-10-10).
const MF_PUBLISHED_IZ0836: [date: string, ratio: number, accrued: number | null][] = [
  ["2026-09-01", 1.0959, null],
  ["2026-10-01", 1.10467, 2.24],
  ["2026-10-02", 1.10478, 2.3],
  ["2026-10-03", 1.10489, 2.36],
  ["2026-10-04", 1.10499, 2.42],
  ["2026-10-05", 1.1051, 2.48],
  ["2026-10-06", 1.10521, 2.54],
  ["2026-10-07", 1.10531, 2.6],
  ["2026-10-08", 1.10542, 2.67],
  ["2026-10-09", 1.10553, 2.73],
  ["2026-10-10", 1.10563, 2.79],
];

let data: MfCalculatorData;
let index: ReferenceIndex;
let iz0836: BondTerms;

beforeAll(() => {
  data = parseMfCalculator(fixture(FIXTURES.mfCalculator));
  index = toReferenceIndex(data.referenceIndex);
  iz0836 = data.bonds.find((b) => b.code === "IZ0836")!;
});

describe("MF calculator import", () => {
  it("reads the monthly reference index and matches the sheet's own chained values", () => {
    expect(data.referenceIndex[0]).toEqual({ month: "2003-07", wr: -0.004, w: 99.6 });
    expect(data.referenceIndex.at(-1)).toEqual({ month: "2026-08", wr: 0.003, w: 215.26519 });
    expect(data.referenceIndex).toHaveLength(278);
  });

  it("reads fixed-rate and indexed series terms", () => {
    const ds = data.bonds.find((b) => b.code === "DS0432")!;
    expect(ds).toMatchObject({ isin: "PL0000113783", couponType: "FIXED", couponRate: 0.0175, maturity: "2032-04-25" });
    expect(ds.periods).toHaveLength(11);
    expect(ds.periods[4]).toEqual({ start: "2025-04-25", end: "2026-04-25", paymentDate: "2026-04-27", amount: 17.5 });

    expect(iz0836).toMatchObject({ isin: "PL0000117024", couponType: "INDEXED", couponRate: 0.02, baseRef: 194.28509, issueDate: "2023-08-25", maturity: "2036-08-25" });
    expect(iz0836.periods[0]).toEqual({ start: "2023-08-25", end: "2024-08-25", paymentDate: "2024-08-26", amount: 20.54 });
    expect(iz0836.periods.at(-1)!.end).toBe("2036-08-25");
  });
});

describe("IZ indexation", () => {
  it("reproduces the base reference index on the issue date", () => {
    expect(Math.round(referenceIndexAt(index, "2023-08-25")! * 1e5) / 1e5).toBe(194.28509);
  });

  it.each(MF_PUBLISHED_IZ0836)("matches the MF published ratio and accrued interest on %s", (date, ratio, accrued) => {
    expect(indexRatioAt(index, iz0836.baseRef!, date)).toBe(ratio);
    const v = valueBond(iz0836, date, { referenceIndex: index });
    expect(v.problem).toBeUndefined();
    expect(v.indexRatio).toBe(ratio);
    expect(v.nominal).toBe(Math.round(1000 * ratio * 100) / 100);
    if (accrued !== null) expect(v.accruedInterest).toBe(accrued);
  });

  it("knows how far the index reaches", () => {
    // last month 2026-08 → usable through October 2026
    expect(referenceIndexCoverageEnd(index)).toBe("2026-10-31");
    expect(referenceIndexAt(index, "2026-11-01")).toBeUndefined();
    expect(valueBond(iz0836, "2026-11-01", { referenceIndex: index }).problem).toBe("missing_reference_index");
  });

  it("values a bond from a clean price", () => {
    const v = valueBond(iz0836, "2026-10-09", { referenceIndex: index });
    // 87.92 % × 1105.53 + 2.73
    expect(dirtyValue(87.92, v)).toBe(974.71);
  });
});

describe("fixed-rate accrued interest", () => {
  it("accrues ACT/ACT towards the published coupon", () => {
    const ds = data.bonds.find((b) => b.code === "DS0432")!;
    expect(valueBond(ds, "2025-04-25")).toMatchObject({ nominal: 1000, accruedInterest: 0, rate: 0.0175 });
    expect(valueBond(ds, "2025-10-25").accruedInterest).toBe(8.77); // 183/365 × 17.50
    expect(valueBond(ds, "2026-04-24").accruedInterest).toBe(17.45);
    expect(valueBond(ds, "2026-04-25").accruedInterest).toBe(0); // new period starts
    expect(valueBond(ds, "2032-04-25").problem).toBe("no_period");
  });

  it("needs a period rate for floating bonds", () => {
    const fl: BondTerms = {
      isin: "PLTEST000001",
      code: "TST0130",
      nominal: 1000,
      currency: "PLN",
      couponType: "FLOATING",
      referenceRate: "WIBOR6M",
      margin: 0.03,
      maturity: "2030-01-15",
      periods: [
        { start: "2026-07-15", end: "2027-01-15", paymentDate: "2027-01-15", rate: 0.0812 },
        { start: "2027-01-15", end: "2027-07-15", paymentDate: "2027-07-15" },
      ],
    };
    expect(valueBond(fl, "2026-10-15").accruedInterest).toBe(40.6); // 92/184 × 1000 × 8.12 %
    expect(valueBond(fl, "2027-02-01").problem).toBe("missing_coupon_rate");
    expect(valueBond(fl, "2027-02-01", { periodRate: 0.08 }).accruedInterest).toBe(7.51);
  });
});
