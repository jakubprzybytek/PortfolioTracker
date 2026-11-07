// The Catalyst exits (Docs/catalyst.md, "Jobs"): GPW's suspensions and exclusions (the current page and the archive
// since 2018, one request each) and Catalyst's special markings, archived raw; the measures on the bonds the table
// holds, the markings' history and what's in force now (core/catalyst/exits.ts). The archive page doubles as the
// backfill. Queues the metrics, whose flags ("suspended", "marked") read what's in force.

import { parseCatalystMarkings, parseGpwExits, planExits } from "@portfolio/core/catalyst/index";
import { today } from "@portfolio/core";
import { archiveRaw, runJob } from "../../lib/context.ts";
import { catalystRepo, queueCatalyst } from "../context.ts";
import { fetchCatalystMarkings, fetchGpwExits } from "../gpwCatalyst.ts";

const SOURCE = "catalyst-exits";

export async function handler() {
  return runJob("catalyst-exits", async () => {
    const date = today();
    const fetchedAt = new Date().toISOString();
    const pages = { current: await fetchGpwExits("current"), archive: await fetchGpwExits("archive"), markings: await fetchCatalystMarkings() };
    for (const [name, html] of Object.entries(pages)) await archiveRaw(SOURCE, date, `${name}.html`, new TextEncoder().encode(html));

    const rows = { current: parseGpwExits(pages.current), archive: parseGpwExits(pages.archive) };
    const markings = parseCatalystMarkings(pages.markings);
    const [bonds, previous] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listMarkings()]);
    const plan = planExits(rows, markings, bonds, previous.map(({ PK: _p, SK: _s, ...m }) => m), date, fetchedAt);

    const written = (await catalystRepo.putEvents(plan.events)) + (await catalystRepo.putMarkings(plan.markings));
    await catalystRepo.putExitsNow(plan.now);
    await queueCatalyst({ kind: "metrics" });
    const suspended = Object.keys(plan.now.suspended).length;
    return {
      itemsWritten: written + 1,
      note: `${plan.events.length} measures on ${new Set(plan.events.map((e) => e.isin)).size} bonds; ${suspended} suspended now; ${markings.length} issuers marked; ${plan.unknownIsins} ISINs not in the table (ended before 2020)`,
    };
  });
}
