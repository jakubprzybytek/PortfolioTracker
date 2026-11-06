// The Catalyst queue's worker (infra/catalyst.ts): up to 10 requests at a time, run in order. Backfill ranges each,
// then the metrics once if any request asked for them. Built step by step (Docs/catalyst-phase1-plan.md): backfill
// in M3, metrics in M6; until then the requests are recorded and do nothing.

import type { SQSEvent } from "aws-lambda";
import { planBatch } from "@portfolio/core/catalyst/index";
import { runJob } from "../../lib/context.ts";

export async function handler(event: SQSEvent): Promise<void> {
  const { backfills, metrics, invalid } = planBatch(event.Records.map((r) => r.body));
  // A malformed request can't succeed on a retry: logged and dropped rather than sent to the dead-letter queue.
  for (const body of invalid) console.error(JSON.stringify({ event: "invalid catalyst request", body: body.slice(0, 500) }));
  for (const range of backfills)
    await runJob("catalyst-backfill", async () => ({ itemsWritten: 0, idle: true, note: `${range.from} – ${range.to}: not built yet (plan, M3)` }));
  if (metrics) await runJob("catalyst-metrics", async () => ({ itemsWritten: 0, idle: true, note: "not built yet (plan, M6)" }));
}
