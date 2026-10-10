// Daily job for GPW treasury bonds: today's all-bonds file plus any missing day in the look-back.
// With { final: true } (the morning re-check) the rows are written as final.

import { addDays, isWeekend, today, type IsoDate } from "@portfolio/core";
import { repo, runJob } from "../lib/context.ts";
import { gpwInstruments, ingestGpwDay } from "../lib/gpwJobs.ts";

const LOOKBACK_DAYS = 14; // calendar days ≈ 10 trading days
const PAUSE_MS = 5000; // gpw.pl resets connections when hit too quickly

export interface EodGpwEvent {
  final?: boolean;
  /** Override "today" (for tests and manual runs). */
  date?: IsoDate;
}

export async function handler(event: EodGpwEvent = {}) {
  return runJob(event.final ? "eod-gpw-recheck" : "eod-gpw", async () => {
    const tracked = gpwInstruments(await repo.listInstruments());
    if (tracked.length === 0) return { itemsWritten: 0, note: "no GPW instruments" };

    const end = event.date ?? today();
    const start = addDays(end, -LOOKBACK_DAYS);
    const status = event.final ? "final" : "provisional";

    // Days any tracked instrument is still missing; the morning re-check always re-fetches the last session.
    const have = await Promise.all(tracked.map((i) => repo.priceDates(i.isin, i.venue, start, end)));
    const missing: IsoDate[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (isWeekend(d)) continue;
      const allHave = have.every((set) => set.has(d));
      if (!allHave || d === end || (event.final && d === addDays(end, -1))) missing.push(d);
    }

    let itemsWritten = 0;
    const notes: string[] = [];
    for (const [i, d] of missing.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
      const n = await ingestGpwDay(d, tracked, status);
      notes.push(`${d}: ${n === null ? "no session" : `${n} rows`}`);
      itemsWritten += n ?? 0;
    }
    return { itemsWritten, note: notes.join(", ") };
  });
}
