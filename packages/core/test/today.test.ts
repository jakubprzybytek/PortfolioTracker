import { describe, expect, it } from "vitest";
import { today } from "../src/dates.ts";

describe("today (Warsaw)", () => {
  it("after midnight in Poland it's already the next day, though UTC still says the day before", () => {
    expect(today(new Date("2026-01-14T23:30:00Z"))).toBe("2026-01-15"); // 00:30 CET
    expect(today(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15"); // 00:30 CEST
    expect(today(new Date("2026-07-14T21:30:00Z"))).toBe("2026-07-14"); // 23:30 CEST
  });

  it("across the daylight-saving changes (last Sunday of March and of October)", () => {
    // 2026-03-29: 02:00 CET → 03:00 CEST. 23:59 UTC on the 28th is 00:59 CET on the 29th.
    expect(today(new Date("2026-03-28T22:59:00Z"))).toBe("2026-03-28");
    expect(today(new Date("2026-03-28T23:00:00Z"))).toBe("2026-03-29");
    expect(today(new Date("2026-03-29T21:59:00Z"))).toBe("2026-03-29"); // 23:59 CEST
    expect(today(new Date("2026-03-29T22:00:00Z"))).toBe("2026-03-30");
    // 2026-10-25: 03:00 CEST → 02:00 CET. Midnight is 22:00 UTC before, 23:00 UTC after.
    expect(today(new Date("2026-10-24T22:00:00Z"))).toBe("2026-10-25");
    expect(today(new Date("2026-10-25T22:59:00Z"))).toBe("2026-10-25"); // 23:59 CET
    expect(today(new Date("2026-10-25T23:00:00Z"))).toBe("2026-10-26");
  });

  it("the scheduled runs fall on their own Warsaw date (22:30 valuation, 07:30 rechecks), summer and winter", () => {
    expect(today(new Date("2026-07-14T20:30:00Z"))).toBe("2026-07-14"); // 22:30 CEST
    expect(today(new Date("2026-01-14T21:30:00Z"))).toBe("2026-01-14"); // 22:30 CET
    expect(today(new Date("2026-07-15T05:30:00Z"))).toBe("2026-07-15"); // 07:30 CEST
  });
});
