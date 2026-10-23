import { describe, expect, it } from "vitest";
import { alertFor } from "../../src/lib/alerts.ts";

describe("alertFor", () => {
  it("alerts when a job starts failing, not on its later failures", () => {
    const first = alertFor("eod-gpw", "failed", { status: "ok" }, "HTTP 503");
    expect(first?.subject).toBe("PortfolioTracker: eod-gpw failed");
    expect(first?.message).toContain("Error: HTTP 503");
    expect(first?.message).toContain("/#/status");
    expect(alertFor("eod-gpw", "failed", undefined, "boom")?.subject).toBe("PortfolioTracker: eod-gpw failed"); // the first run ever
    expect(alertFor("eod-gpw", "failed", { status: "failed" }, "HTTP 503")).toBeUndefined(); // a retry, or the next run
  });

  it("tells when it works again; quiet while all is well", () => {
    const back = alertFor("eod-gpw", "ok", { status: "failed", finishedAt: "2026-10-23T20:30:05Z" }, "12 rows");
    expect(back?.subject).toBe("PortfolioTracker: eod-gpw works again");
    expect(back?.message).toContain("failed last at 2026-10-23T20:30:05Z");
    expect(alertFor("eod-gpw", "ok", { status: "ok" })).toBeUndefined();
    expect(alertFor("eod-gpw", "ok", undefined)).toBeUndefined();
  });
});
