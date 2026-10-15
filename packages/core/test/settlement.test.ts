import { beforeAll, describe, expect, it } from "vitest";
import { valueBondAtSettlement } from "../src/bonds/accrued.ts";
import { indexRatioAt, toReferenceIndex, type ReferenceIndex } from "../src/bonds/izIndex.ts";
import type { BondTerms } from "../src/bonds/terms.ts";
import { parseGpwHistoryXls } from "../src/gpw/parseHistory.ts";
import { parseMfCalculator, type MfCalculatorData } from "../src/mf/calculator.ts";
import { easterSunday, isSettlementDay, settlementDate } from "../src/settlement.ts";
import { FIXTURES, fixture } from "./fixtures.ts";

let data: MfCalculatorData;
let index: ReferenceIndex;
let iz: BondTerms;
let ds: BondTerms;

beforeAll(() => {
  data = parseMfCalculator(fixture(FIXTURES.mfCalculator));
  index = toReferenceIndex(data.referenceIndex);
  iz = data.bonds.find((b) => b.code === "IZ0836")!;
  ds = data.bonds.find((b) => b.code === "DS0432")!;
});

describe("settlement days", () => {
  it("knows Easter and the days without a session", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    for (const d of ["2025-04-18", "2025-04-21", "2025-06-19", "2025-12-24", "2025-12-31", "2026-01-06", "2026-11-11"]) expect(isSettlementDay(d), d).toBe(false);
    expect(isSettlementDay("2026-10-15")).toBe(true);
  });

  it("settles two settlement days after the trade; a weekend settles with the Friday", () => {
    expect(settlementDate("2026-10-15")).toBe("2026-10-19"); // Thursday → Monday
    expect(settlementDate("2026-10-16")).toBe("2026-10-20");
    expect(settlementDate("2026-10-17")).toBe("2026-10-20"); // Saturday
    expect(settlementDate("2025-12-22")).toBe("2025-12-29"); // over 24–26 December
    expect(settlementDate("2025-04-17")).toBe("2025-04-23"); // over Good Friday and Easter Monday
  });

  it("matches GPW's settlement-dated nominal of IZ0836 on every session it published one", () => {
    // GPW's "Cena nominalna" is 1000 × the index ratio on the settlement day, rounded; mostly 1000 since 2025-09-29.
    const rows = parseGpwHistoryXls(fixture(FIXTURES.izHistory)).filter((r) => r.date < "2025-09-29");
    expect(rows.length).toBeGreaterThan(300);
    const misses = rows.filter((r) => Math.round(1000 * indexRatioAt(index, iz.baseRef!, settlementDate(r.date))!) !== r.gpwNominal);
    expect(misses.map((r) => r.date)).toEqual([]);
  });
});

describe("valueBondAtSettlement", () => {
  it("IZ0836: as the Ministry publishes it for the settlement day", () => {
    // Thursday 2026-10-15 → Monday 10-19: ratio 1.10660, 3.33 PLN (gov.pl, gpwcatalyst.pl read 2026-10-15)
    expect(valueBondAtSettlement(iz, "2026-10-15", { referenceIndex: index })).toMatchObject({ settlementDate: "2026-10-19", nominal: 1106.6, accruedInterest: 3.33 });
  });

  it("DS0432 around its coupon: the coupon not paid yet counts whole, then the new period", () => {
    const pay = ds.periods.find((p) => p.end === "2026-04-25")!.paymentDate;
    // Thursday 2026-04-23 settles on Monday 04-27: 17.50 coupon + 2 days of the new period (0.10)
    expect(valueBondAtSettlement(ds, "2026-04-23").accruedInterest).toBe(17.6);
    // From the payment day the coupon is cash: only the new period
    expect(valueBondAtSettlement(ds, pay).accruedInterest).toBeLessThan(1);
    expect(valueBondAtSettlement(ds, "2026-04-22").accruedInterest).toBe(17.45); // settles on the 24th: 364 days
  });

  it("near maturity: the last coupon, the nominal at maturity", () => {
    expect(valueBondAtSettlement(ds, "2032-04-22")).toMatchObject({ nominal: 1000, accruedInterest: 17.5 });
  });
});
