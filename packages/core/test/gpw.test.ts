import { describe, expect, it } from "vitest";
import { parseGpwHistoryXls } from "../src/gpw/parseHistory.ts";
import { FIXTURES, fixture } from "./fixtures.ts";

describe("parseGpwHistoryXls", () => {
  it("parses a bond's full history file", () => {
    const rows = parseGpwHistoryXls(fixture(FIXTURES.dsHistory));
    expect(rows).toHaveLength(1334);
    expect(rows[0]).toMatchObject({ date: "2021-06-16", instrument: "DS0432", isin: "PL0000113783", traded: false, close: 99.4 });
    expect(rows[0]!.open).toBeNull();
    expect(rows.at(-1)).toEqual({
      date: "2026-10-09",
      instrument: "DS0432",
      isin: "PL0000113783",
      currency: "PLN",
      open: 81.5,
      high: 81.5,
      low: 81.08,
      close: 81.09,
      changePct: -0.39,
      volume: 830,
      trades: 15,
      turnoverThousands: 680.15,
      gpwNominal: 1000,
      traded: true,
    });
  });

  it("keeps rows sorted by date and unique", () => {
    const rows = parseGpwHistoryXls(fixture(FIXTURES.izHistory));
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBe(dates.length);
    expect(rows.filter((r) => r.traded)).toHaveLength(567);
  });

  it("parses a one-day all-bonds file with the same columns", () => {
    const rows = parseGpwHistoryXls(fixture(FIXTURES.day20261009));
    expect(rows).toHaveLength(72);
    expect(new Set(rows.map((r) => r.date))).toEqual(new Set(["2026-10-09"]));
    const iz = rows.find((r) => r.instrument === "IZ0836");
    expect(iz).toMatchObject({ isin: "PL0000117024", close: 87.92, volume: 1607, gpwNominal: 1106 });
  });

  it("fails loudly on an unknown layout", () => {
    expect(() => parseGpwHistoryXls(fixture(FIXTURES.mfCalculator))).toThrow(/Column "Data" not found/);
  });
});
