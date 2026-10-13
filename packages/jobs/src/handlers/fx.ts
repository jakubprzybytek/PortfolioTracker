// Daily NBP exchange rates (table A) for EUR, USD and every currency an instrument is priced in.
// Fetches from the day after the last stored rate, so the first run backfills from 2002.
// When foreign-currency instruments exist and older rates arrived, the affected days are revalued.

import { Resource } from "sst";
import { addDays, firstTransactionDate, today, type IsoDate } from "@portfolio/core";
import { queueValuation, repo, runJob } from "../lib/context.ts";
import { NBP_FIRST_DATE, fetchNbpRates } from "../lib/nbp.ts";

/** Always kept (exchange rates in the Indicators view), whatever is held. */
export const FX_CURRENCIES = ["EUR", "USD"];

export async function handler(event: { to?: IsoDate } = {}) {
  return runJob("fx", async () => {
    const instruments = await repo.listInstruments();
    const foreign = new Set(instruments.filter((i) => i.active && i.currency !== "PLN").map((i) => i.currency));
    const currencies = [...new Set([...FX_CURRENCIES, ...foreign])].sort();
    const to = event.to ?? today();

    let written = 0;
    let earliestNew: IsoDate | undefined;
    const notes: string[] = [];
    for (const currency of currencies) {
      const last = await repo.latestFxRate(currency, to);
      const from = last ? addDays(last.date, 1) : NBP_FIRST_DATE;
      if (from > to) continue;
      const rates = await fetchNbpRates(currency, from, to);
      if (rates.length === 0) continue;
      written += await repo.putFxRates(rates.map((r) => ({ ...r, source: "nbp-a" })));
      notes.push(`${currency}: ${rates.length} (${rates[0]!.date} → ${rates.at(-1)!.date})`);
      // Only rates for days already valued matter for a revaluation (today's are used by tonight's run).
      if (foreign.has(currency) && rates[0]!.date < to && (!earliestNew || rates[0]!.date < earliestNew)) earliestNew = rates[0]!.date;
    }
    const first = earliestNew && firstTransactionDate(await repo.listTransactions());
    if (earliestNew && first) await queueValuation({ from: earliestNew > first ? earliestNew : first, reason: "fx" });
    return { itemsWritten: written, note: notes.join("; ") || "up to date" };
  });
}
