// Switches AI analysis on for the companies whose bonds you hold (Docs/catalyst.md, "AI analysis per company": on
// from the start for them). Reads PT's transactions (read only), finds the bonds held today, their companies (the
// links made by scripts/catalyst-identity.ts) and switches on those not switched yet; a company switched off by you
// is left alone. A dry run unless --write. Run inside the stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-ai-holdings.ts [--write]

import { Resource } from "sst";
import { positionsAt, Repository, today } from "@portfolio/core";
import { CatalystRepository } from "@portfolio/core/catalyst/index";

const write = process.argv.includes("--write");
const pt = new Repository({ market: Resource.Market.name, transactions: Resource.Transactions.name, holdings: Resource.Holdings.name });
const catalyst = new CatalystRepository(() => Resource.Catalyst.name);

const held = new Set([...positionsAt(await pt.listTransactions(), today()).values()].filter((p) => p.quantity > 0).map((p) => p.isin));
const [links, entities] = await Promise.all([catalyst.listLinks(), catalyst.listEntities()]);
const entityBy = new Map(entities.map((e) => [e.entityId, e]));
const companies = new Map<string, string[]>();
for (const l of links) if (l.entityId && held.has(l.isin)) companies.set(l.entityId, [...(companies.get(l.entityId) ?? []), l.code]);
const heldOnCatalyst = links.filter((l) => held.has(l.isin)).length;
console.log(`${held.size} instruments held; ${heldOnCatalyst} of them Catalyst bonds with a link; ${companies.size} companies`);

const at = new Date().toISOString();
const toSwitch = [...companies.keys()].map((id) => entityBy.get(id)!).filter((e) => e && !e.aiAnalysis);
for (const e of toSwitch) console.log(`  on: ${e.shortName} (${e.entityId}) for ${companies.get(e.entityId)!.join(", ")}`);
for (const [id] of companies) if (entityBy.get(id)?.aiAnalysis) console.log(`  already set: ${entityBy.get(id)!.shortName} (${entityBy.get(id)!.aiAnalysis!.on ? "on" : "off"})`);
if (!write) console.log("dry run: nothing written (--write to switch them on)");
else {
  const written = await catalyst.putEntities(toSwitch.map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...e }) => ({ ...e, aiAnalysis: { on: true, by: "setup: bonds held in PT", at }, updatedAt: at })));
  console.log(`switched on: ${written}`);
}
