// Daily job for IBKR's mark prices (Flex Web Service): the last two weeks of every instrument priced from IBKR (venue
// IBKR: US T-bills), so a missed day fills itself in, and a check of the bonds priced from onvista against IBKR's marks.
// Runs before the morning valuation, which picks the prices up.

import { addDays, today, type IsoDate } from "@portfolio/core";
import { repo, runJob } from "../lib/context.ts";
import { flexToken } from "../lib/ibkrFlex.ts";
import { checkAgainstIbkr, ibkrInstruments, loadStatement, storeIbkrPrices } from "../lib/ibkrJobs.ts";

const LOOKBACK_DAYS = 14;

export async function handler(event: { date?: IsoDate } = {}) {
  return runJob("eod-ibkr", async () => {
    if (!flexToken()) return { itemsWritten: 0, note: "no IBKR Flex token on this stage" };
    const instruments = await repo.listInstruments();
    const day = event.date ?? today();
    const to = addDays(day, -1); // IBKR's statements end with the last business day
    const statement = await loadStatement(addDays(day, -LOOKBACK_DAYS), to, day);
    const tracked = ibkrInstruments(instruments);
    const written = await storeIbkrPrices(tracked, statement);
    const itemsWritten = [...written.values()].reduce((a, b) => a + b, 0);
    const missing = tracked.filter((i) => !written.get(i.isin)).map((i) => i.code);
    const checks = await checkAgainstIbkr(instruments.filter((i) => i.type === "BOND_IBKR"), statement);
    const note = [
      `${tracked.length} instruments priced from IBKR, ${itemsWritten} prices ${statement.from} – ${statement.to}`,
      ...(missing.length ? [`no IBKR price for ${missing.join(", ")}`] : []),
      ...(checks.length ? checks : [`${statement.open.length} positions checked`]),
    ].join("; ");
    return { itemsWritten, note };
  });
}
