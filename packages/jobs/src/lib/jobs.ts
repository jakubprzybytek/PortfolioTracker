// Every job that records its runs (`runJob`), with how long it may go without a successful run before the watchdog
// says so. The Status page lists the same jobs, so a new job shows there once it's added here.

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
} satisfies Record<string, { maxAgeHours?: number; prices?: boolean; optional?: boolean }>;

export type JobName = keyof typeof JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** A run still marked running after this long has timed out (no function runs longer than 15 minutes). */
export const RUNNING_LIMIT_MS = 20 * 60_000;
