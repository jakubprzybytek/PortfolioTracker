// Daily check of the job runs (lib/watchdog.ts). Problems fail the run, so `runJob` e-mails them (once, when the
// watchdog starts failing, and again when all is well). A CloudWatch alarm watches the watchdog itself.

import { JOB_NAMES } from "../lib/jobs.ts";
import { repo, runJob } from "../lib/context.ts";
import { NO_PRICES_HOURS, watchdogIssues } from "../lib/watchdog.ts";

export async function handler() {
  return runJob("watchdog", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - NO_PRICES_HOURS * 3_600_000).toISOString();
    const [runs, latest] = await Promise.all([
      Promise.all(JOB_NAMES.map(async (j) => [j, await repo.recentJobRuns(j, since)] as const)),
      Promise.all(JOB_NAMES.map(async (j) => [j, await repo.latestJobRun(j)] as const)),
    ]);
    const issues = watchdogIssues(new Map(runs), new Map(latest), now);
    if (issues.length) throw new Error(issues.join("; "));
    return { itemsWritten: 0, note: `${JOB_NAMES.length} jobs checked, all fine` };
  });
}
