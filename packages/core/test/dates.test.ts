import { describe, expect, it } from "vitest";
import { addDays, daysBetween, daysInMonth, eachDay, excelSerialToIsoDate, isWeekend, shiftMonth } from "../src/dates.ts";

describe("dates", () => {
  it("adds days across month and DST boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("counts days and months", () => {
    expect(daysBetween("2025-04-25", "2026-04-25")).toBe(365);
    expect(daysBetween("2023-08-25", "2024-08-25")).toBe(366);
    expect(shiftMonth("2026-01", -3)).toBe("2025-10");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(daysInMonth(2024, 2)).toBe(29);
  });
  it("lists days and weekends", () => {
    expect(eachDay("2026-10-09", "2026-10-12")).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(isWeekend("2026-10-10")).toBe(true);
    expect(isWeekend("2026-10-12")).toBe(false);
  });
  it("converts Excel serial dates", () => {
    expect(excelSerialToIsoDate(45163)).toBe("2023-08-25");
    expect(excelSerialToIsoDate(37803)).toBe("2003-07-01");
  });
});
