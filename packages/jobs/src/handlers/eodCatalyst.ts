// Daily job for Catalyst corporate bonds (BiznesRadar): the last ~50 sessions and today's quote of every listed bond.

import { today, type IsoDate } from "@portfolio/core";
import { repo, runJob } from "../lib/context.ts";
import { catalystInstruments, ingestBiznesradarRecent } from "../lib/catalystJobs.ts";

export async function handler(event: { date?: IsoDate } = {}) {
  return runJob("eod-catalyst", async () => {
    const tracked = catalystInstruments(await repo.listInstruments());
    if (tracked.length === 0) return { itemsWritten: 0, note: "no Catalyst bonds" };
    const day = event.date ?? today();
    let itemsWritten = 0;
    const failed: string[] = [];
    for (const inst of tracked) {
      try {
        itemsWritten += await ingestBiznesradarRecent(inst, day);
      } catch (err) {
        failed.push(`${inst.code}: ${(err as Error).message}`);
      }
    }
    // Any failure marks the run failed (Dashboard banner); the other bonds' prices are written anyway.
    if (failed.length) throw new Error(`${failed.length}/${tracked.length} bonds failed: ${failed.join("; ")}`);
    return { itemsWritten, note: `${tracked.length} bonds` };
  });
}
