// Daily job for the benchmarks of the Performance view (WIG, MSCI World): after the evening closes, and a morning
// pass for anything missed. A failure of one doesn't stop the other; the run is marked failed.

import { BENCHMARKS } from "@portfolio/core";
import { ingestBenchmark } from "../lib/benchmarkJobs.ts";
import { runJob } from "../lib/context.ts";

export async function handler() {
  return runJob("benchmarks", async () => {
    let itemsWritten = 0;
    const notes: string[] = [];
    const failed: string[] = [];
    for (const b of BENCHMARKS) {
      try {
        const r = await ingestBenchmark(b);
        itemsWritten += r.written;
        notes.push(r.note);
      } catch (err) {
        failed.push(`${b.label}: ${(err as Error).message}`);
      }
    }
    if (failed.length) throw new Error(`${failed.length}/${BENCHMARKS.length} benchmarks failed: ${failed.join("; ")}`);
    return { itemsWritten, note: notes.join("; ") };
  });
}
