// The Catalyst queue's worker (infra/catalyst.ts): up to 10 requests at a time, run in order. Backfill ranges each
// (backfill.ts), then the metrics once if any request asked for them (metrics.ts).
// A range that fails is recorded (a failed job run: the Status page, an alert on prod) and the others go on: failing
// the batch would retry all ten and send them to the dead-letter queue together. Running the backfill script again
// loads what's missing (loaded days are skipped).

import type { Context, SQSEvent } from "aws-lambda";
import { planBatch } from "@portfolio/core/catalyst/index";
import { runJob } from "../../lib/context.ts";
import { backfillRange } from "../backfill.ts";
import { computeMetrics } from "../metrics.ts";

export async function handler(event: SQSEvent, context: Context): Promise<void> {
  const { backfills, metrics, invalid } = planBatch(event.Records.map((r) => r.body));
  // A malformed request can't succeed on a retry: logged and dropped rather than sent to the dead-letter queue.
  for (const body of invalid) console.error(JSON.stringify({ event: "invalid catalyst request", body: body.slice(0, 500) }));
  for (const range of backfills) await runJob("catalyst-backfill", () => backfillRange(range.from, range.to, () => context.getRemainingTimeInMillis())).catch(() => undefined);
  if (metrics) await runJob("catalyst-metrics", computeMetrics);
}
