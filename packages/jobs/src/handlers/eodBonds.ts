// Daily job for the foreign government bonds at IBKR (onvista, Börse Stuttgart): the last two weeks of closes and
// today's quote of every tracked bond, so a missed day fills itself in.

import { today, type IsoDate } from "@portfolio/core";
import { repo, runJob } from "../lib/context.ts";
import { ingestOnvistaRecent, onvistaInstruments } from "../lib/onvistaJobs.ts";

const LOOKBACK_DAYS = 14;

export async function handler(event: { date?: IsoDate } = {}) {
  return runJob("eod-bonds", async () => {
    const tracked = onvistaInstruments(await repo.listInstruments());
    if (tracked.length === 0) return { itemsWritten: 0, note: "no foreign bonds" };
    const day = event.date ?? today();
    let itemsWritten = 0;
    const failed: string[] = [];
    for (const inst of tracked) {
      try {
        itemsWritten += await ingestOnvistaRecent(inst, day, LOOKBACK_DAYS);
      } catch (err) {
        failed.push(`${inst.code}: ${(err as Error).message}`);
      }
    }
    // Any failure marks the run failed (Dashboard banner); the other bonds' prices are written anyway.
    if (failed.length) throw new Error(`${failed.length}/${tracked.length} bonds failed: ${failed.join("; ")}`);
    return { itemsWritten, note: `${tracked.length} bonds` };
  });
}
