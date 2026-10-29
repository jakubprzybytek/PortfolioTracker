// Daily job for ETFs (Yahoo): the last two weeks of every tracked ETF, so a missed day fills itself in.

import { today, type IsoDate } from "@portfolio/core";
import { repo, runJob } from "../lib/context.ts";
import { ingestYahooRecent, yahooInstruments } from "../lib/etfJobs.ts";

const LOOKBACK_DAYS = 14;

export async function handler(event: { date?: IsoDate } = {}) {
  return runJob("eod-etf", async () => {
    const tracked = yahooInstruments(await repo.listInstruments());
    if (tracked.length === 0) return { itemsWritten: 0, idle: true, note: "no ETFs" };
    const end = event.date ?? today();
    let itemsWritten = 0;
    const warnings: string[] = [];
    const failed: string[] = [];
    for (const inst of tracked) {
      try {
        const r = await ingestYahooRecent(inst, end, LOOKBACK_DAYS);
        itemsWritten += r.written;
        warnings.push(...r.warnings);
      } catch (err) {
        failed.push(`${inst.code}: ${(err as Error).message}`);
      }
    }
    // Any failure marks the run failed (Dashboard banner); the other ETFs' prices are written anyway.
    if (failed.length) throw new Error(`${failed.length}/${tracked.length} ETFs failed: ${failed.join("; ")}`);
    const notes = [`${tracked.length - failed.length}/${tracked.length} ETFs`, ...failed, ...warnings];
    return { itemsWritten, note: notes.join("; ") };
  });
}
