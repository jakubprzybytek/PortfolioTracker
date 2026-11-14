// Requests on the Catalyst queue (infra/catalyst.ts): recompute the screen, load a range of the daily-file archive, or
// (re)build the premium history (Docs/catalyst-premium-history-plan.md: from the start, or on from a bond).

import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CatalystMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("metrics") }),
  z.object({ kind: z.literal("backfill"), from: isoDate, to: isoDate }),
  z.object({ kind: z.literal("premiums"), after: z.string().max(20).optional() }),
]);
export type CatalystMessage = z.output<typeof CatalystMessage>;

/**
 * A batch of messages as the worker runs it: each backfill range in order, then the premium history's runs in order,
 * then the metrics once if any message asked for them (a burst of requests recomputes once). Messages that aren't
 * valid are returned apart.
 */
export function planBatch(bodies: string[]): { backfills: { from: string; to: string }[]; premiums: { after?: string }[]; metrics: boolean; invalid: string[] } {
  const backfills: { from: string; to: string }[] = [];
  const premiums: { after?: string }[] = [];
  const invalid: string[] = [];
  let metrics = false;
  for (const body of bodies) {
    let parsed: ReturnType<typeof CatalystMessage.safeParse>;
    try {
      parsed = CatalystMessage.safeParse(JSON.parse(body));
    } catch {
      invalid.push(body);
      continue;
    }
    if (!parsed.success) invalid.push(body);
    else if (parsed.data.kind === "metrics") metrics = true;
    else if (parsed.data.kind === "premiums") premiums.push(parsed.data.after ? { after: parsed.data.after } : {});
    else backfills.push({ from: parsed.data.from, to: parsed.data.to });
  }
  return { backfills, premiums, metrics, invalid };
}
