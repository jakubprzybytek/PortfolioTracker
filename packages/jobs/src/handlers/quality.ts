// Daily data-quality check (road map 17): the last year of prices of every held instrument with a price source,
// checked for gaps, prices that stopped coming, jumps and implausible bond prices (core/quality/quality.ts). The
// report replaces the previous one (QUALITY/LATEST, shown on the Status page); issues not in the previous report are
// e-mailed (alerts.ts), so a known issue is reported once. Nothing is changed: fixing a gap is a backfill.

import { addDays, isQuoted, issueKey, priceIssues, today, type QualityIssue } from "@portfolio/core";
import { sendAlert } from "../lib/alerts.ts";
import { repo, runJob } from "../lib/context.ts";

const STATUS_URL = "https://portfoliotracker.albedoonline.com/#/status";

export async function handler(event: { date?: string } = {}) {
  return runJob("quality", async () => {
    const day = event.date ?? today();
    const lastDay = addDays(day, -1); // today's prices may still be on their way
    const from = addDays(day, -365);
    const [instruments, snapshot, previous] = await Promise.all([repo.listInstruments(), repo.getSnapshot("LATEST"), repo.getQualityReport()]);
    const held = new Set((snapshot?.holdings ?? []).filter((h) => h.quantity > 0).map((h) => h.isin));
    const checked = instruments.filter((i) => held.has(i.isin) && isQuoted(i));
    const issues: QualityIssue[] = [];
    for (const inst of checked) issues.push(...priceIssues(inst, await repo.queryPrices(inst.isin, inst.venue, addDays(from, -14), day), from, lastDay));
    await repo.putQualityReport({ checkedAt: new Date().toISOString(), instruments: checked.length, from, lastDay, issues });

    const known = new Set((previous?.issues ?? []).map(issueKey));
    const added = issues.filter((i) => !known.has(issueKey(i)));
    if (added.length) {
      const lines = added.slice(0, 30).map((i) => `- ${i.code}: ${i.kind}, ${i.detail}`);
      if (added.length > 30) lines.push(`… and ${added.length - 30} more`);
      await sendAlert({
        subject: `PortfolioTracker: ${added.length} new data-quality issue${added.length > 1 ? "s" : ""}`,
        message: [`The daily check of ${checked.length} instruments' prices found:`, "", ...lines, "", `All issues: ${STATUS_URL}`].join("\n"),
      });
    }
    return { itemsWritten: 1, note: `${checked.length} instruments, ${issues.length} issues (${added.length} new)` };
  });
}
