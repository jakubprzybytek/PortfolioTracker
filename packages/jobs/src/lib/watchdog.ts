// What `runJob` can't see by itself: a run the function's timeout cut off (still "running"), a job that stopped
// running (a schedule that no longer fires), and a price job that keeps finishing without a single new price (a
// source returning nothing). Pure: the handler reads the runs, this decides.

import type { JobRunItem } from "@portfolio/core";
import { JOBS, RUNNING_LIMIT_MS, type JobName } from "./jobs.ts";

/** A price job that wrote nothing at all over this long is flagged (a long weekend or holiday fits in it). */
export const NO_PRICES_HOURS = 120;

/** One line per problem found; empty when all is well. `runs`: each job's runs over the last NO_PRICES_HOURS, newest first. */
export function watchdogIssues(runs: Map<JobName, JobRunItem[]>, latest: Map<JobName, JobRunItem | undefined>, now: Date): string[] {
  const issues: string[] = [];
  const hoursAgo = (iso: string) => (now.getTime() - Date.parse(iso)) / 3_600_000;
  for (const [job, cfg] of Object.entries(JOBS) as [JobName, (typeof JOBS)[JobName]][]) {
    const recent = runs.get(job) ?? [];
    for (const r of recent)
      if (r.status === "running" && now.getTime() - Date.parse(r.startedAt) > RUNNING_LIMIT_MS) issues.push(`${job}: the run started ${r.startedAt} never finished (timed out?)`);
    if (job === "watchdog") continue; // this run is about to be recorded
    const last = latest.get(job);
    const maxAge = "maxAgeHours" in cfg ? cfg.maxAgeHours : undefined;
    if (maxAge !== undefined) {
      if (!last) {
        if (!("optional" in cfg)) issues.push(`${job}: has never run`);
      } else if (hoursAgo(last.startedAt) > maxAge) issues.push(`${job}: no run for ${Math.round(hoursAgo(last.startedAt))} h (expected at least every ${maxAge} h)`);
    }
    if ("prices" in cfg && recent.some((r) => r.status === "ok") && !recent.some((r) => (r.itemsWritten ?? 0) > 0))
      issues.push(`${job}: no new prices in ${NO_PRICES_HOURS} h (${recent.length} runs)`);
  }
  return issues;
}
