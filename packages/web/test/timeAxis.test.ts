import { describe, expect, it } from "vitest";
import { timeAxis } from "../src/timeAxis.ts";

/** Weekdays from `from` to `to` (sessions). */
function sessions(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe("timeAxis", () => {
  it("a year of sessions: a tick on each month's first session, the year's start as the year", () => {
    const a = timeAxis(sessions("2025-11-14", "2026-11-12"), 12);
    expect(a.ticks).toEqual(["2025-12-01", "2026-01-01", "2026-02-02", "2026-03-02", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01", "2026-11-02"]);
    expect(a.ticks.map(a.format)).toEqual(["Dec", "2026", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(a.yearStarts).toEqual(["2026-01-01"]);
    expect(a.isYearStart("2026-01-01")).toBe(true);
    expect(a.isYearStart("2026-02-02")).toBe(false);
  });

  it("the first point isn't a tick: the data starts mid-month", () => {
    expect(timeAxis(sessions("2026-03-01", "2026-11-12"), 12).ticks[0]).toBe("2026-04-01");
  });

  it("fewer ticks on a narrow chart: every other month or quarter, counted from January (the year stays)", () => {
    const a = timeAxis(sessions("2025-11-14", "2026-11-12"), 6);
    expect(a.ticks.map(a.format)).toEqual(["2026", "Mar", "May", "Jul", "Sep", "Nov"]);
    const q = timeAxis(sessions("2025-11-14", "2026-11-12"), 4);
    expect(q.ticks.map(q.format)).toEqual(["2026", "Apr", "Jul", "Oct"]);
  });

  it("years of data: the years only", () => {
    const a = timeAxis(sessions("2020-01-02", "2026-11-12"), 8);
    expect(a.ticks.map(a.format)).toEqual(["2021", "2022", "2023", "2024", "2025", "2026"]);
  });

  it("a month: a tick a week, on its first session", () => {
    const a = timeAxis(sessions("2026-10-13", "2026-11-12"), 10);
    expect(a.ticks).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(a.ticks.map(a.format)).toEqual(["19 Oct", "26 Oct", "2 Nov", "9 Nov"]);
  });

  it("no data or a single point: no ticks", () => {
    expect(timeAxis([], 10).ticks).toEqual([]);
    expect(timeAxis(["2026-11-12"], 10).ticks).toEqual([]);
  });
});
