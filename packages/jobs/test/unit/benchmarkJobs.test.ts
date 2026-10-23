import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/context.ts", () => ({ repo: {}, archiveRaw: vi.fn() }));
const { changedCloses } = await import("../../src/lib/benchmarkJobs.ts");

describe("changedCloses", () => {
  it("keeps the days from `from` on that are new or changed", () => {
    const fetched = [
      { date: "2026-10-01", close: 1 }, // before the look-back
      { date: "2026-10-20", close: 2 }, // same as stored
      { date: "2026-10-21", close: 3.5 }, // changed
      { date: "2026-10-22", close: 4 }, // new
    ];
    const stored = [
      { date: "2026-10-20", close: 2 },
      { date: "2026-10-21", close: 3 },
    ];
    expect(changedCloses(fetched, stored, "2026-10-09").map((c) => c.date)).toEqual(["2026-10-21", "2026-10-22"]);
  });
});
