import { describe, expect, it } from "vitest";
import type { JobRunItem } from "@portfolio/core";
import { JOB_NAMES, type JobName } from "../../src/lib/jobs.ts";
import { watchdogIssues } from "../../src/lib/watchdog.ts";

const NOW = new Date("2026-10-29T08:45:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const run = (job: string, h: number, r: Partial<JobRunItem> = {}): JobRunItem => ({ PK: `JOB#${job}`, SK: `RUN#${ago(h)}`, job, startedAt: ago(h), finishedAt: ago(h), status: "ok", itemsWritten: 3, ttl: 0, ...r });

/** Every job ran fine an hour ago, wrote something; then `change` applied. */
function check(change: (runs: Map<JobName, JobRunItem[]>) => void) {
  const runs = new Map(JOB_NAMES.map((j) => [j, [run(j, 1)]] as [JobName, JobRunItem[]]));
  change(runs);
  const latest = new Map(JOB_NAMES.map((j) => [j, runs.get(j)![0]] as [JobName, JobRunItem | undefined]));
  return watchdogIssues(runs, latest, NOW);
}

describe("watchdog", () => {
  it("all fine: nothing to say", () => {
    expect(check(() => {})).toEqual([]);
  });

  it("a run still marked running after 20 minutes timed out; one just started is fine", () => {
    expect(check((r) => r.set("valuation", [run("valuation", 0.1, { status: "running", finishedAt: undefined })]))).toEqual([]);
    expect(check((r) => r.set("valuation", [run("valuation", 1, { status: "running", finishedAt: undefined })]))).toEqual([`valuation: the run started ${ago(1)} never finished (timed out?)`]);
  });

  it("a scheduled job with no run for longer than its schedule allows; on-demand ones never", () => {
    expect(check((r) => r.set("valuation", [run("valuation", 50)]))).toEqual(["valuation: no run for 50 h (expected at least every 45 h)"]);
    expect(check((r) => r.set("import", [run("import", 2000)]))).toEqual([]);
  });

  it("a job that never ran, except an optional one (IBKR, only where its token is)", () => {
    expect(check((r) => r.set("coupons", []))).toEqual(["coupons: has never run"]);
    expect(check((r) => r.set("eod-ibkr", []))).toEqual([]);
  });

  it("a price job whose runs all wrote nothing", () => {
    expect(check((r) => r.set("eod-etf", [run("eod-etf", 1, { itemsWritten: 0 }), run("eod-etf", 13, { itemsWritten: 0 })]))).toEqual(["eod-etf: no new prices in 120 h (2 runs)"]);
    expect(check((r) => r.set("eod-etf", [run("eod-etf", 1, { itemsWritten: 0 }), run("eod-etf", 13)]))).toEqual([]);
    expect(check((r) => r.set("quality", [run("quality", 1, { itemsWritten: 0 })]))).toEqual([]); // not a price job
  });
});
