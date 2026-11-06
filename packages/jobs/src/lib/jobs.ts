// Every job that records its runs (`runJob`), with how long it may go without a successful run before the watchdog
// says so, and the table its runs are kept in. The Status page lists the same jobs, so a new job shows there once
// it's added here.

/** Tables that keep job runs: `market` for PT's jobs, `catalyst` for the Catalyst module's (Docs/catalyst.md). */
export type JobTable = "market" | "catalyst";

/** Hours between successful runs, at most (the longest gap in its schedule plus slack); none: started on demand. */
export const JOBS = {
  "eod-gpw": { maxAgeHours: 78, prices: true },
  "eod-gpw-recheck": { maxAgeHours: 78 },
  "eod-etf": { maxAgeHours: 78, prices: true },
  "eod-catalyst": { maxAgeHours: 78, prices: true },
  "eod-bonds": { maxAgeHours: 78, prices: true },
  // Only where the IbkrFlexToken secret is (dev, prod).
  "eod-ibkr": { maxAgeHours: 78, prices: true, optional: true },
  benchmarks: { maxAgeHours: 78, prices: true },
  quality: { maxAgeHours: 78 },
  coupons: { maxAgeHours: 78 },
  fx: { maxAgeHours: 78 },
  valuation: { maxAgeHours: 45 },
  monthly: { maxAgeHours: 32 * 24 },
  export: { maxAgeHours: 32 * 24 },
  watchdog: { maxAgeHours: 50 },
  live: {},
  backfill: {},
  import: {},
  // The Catalyst module: the daily file (evenings, morning recheck); requests from its queue (metrics, backfill).
  "catalyst-daily": { maxAgeHours: 78, prices: true, table: "catalyst" },
  "catalyst-quotes": { maxAgeHours: 78, prices: true, table: "catalyst" },
  "catalyst-terms": { maxAgeHours: 78, table: "catalyst" },
  "catalyst-metrics": { table: "catalyst" },
  "catalyst-backfill": { table: "catalyst" },
} satisfies Record<string, { maxAgeHours?: number; prices?: boolean; optional?: boolean; table?: JobTable }>;

export type JobName = keyof typeof JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** The table a job's runs are kept in (`market` unless the job says otherwise). */
export const jobTable = (job: JobName): JobTable => (JOBS[job] as { table?: JobTable }).table ?? "market";

/** A run still marked running after this long has timed out (no function runs longer than 15 minutes). */
export const RUNNING_LIMIT_MS = 20 * 60_000;
