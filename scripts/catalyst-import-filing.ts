// Imports one report into a company's financial years (Docs/catalyst-phase2-plan.md, N3; the CLI's
// `catalyst filings import` does the same through the API from N7). The file is read here, on this machine; the
// result is checked again and stored with the most recent report winning. A dry run unless --write. Inside the
// stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-import-filing.ts <file> --entity <id> [--transcript t.json --by "<who>"] [--force] [--write]

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { readFiling, readPdfFiling, isPdf } from "@portfolio/core/catalyst/filings/index";
import { storeFiling } from "../packages/jobs/src/catalyst/filings.ts";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = args[0];
const entityId = opt("--entity");
if (!file || !entityId) throw new Error("usage: node scripts/catalyst-import-filing.ts <file> --entity <id> [--transcript t.json --by <who>] [--force] [--write]");

const data = readFileSync(file);
const transcript = opt("--transcript");
const read = isPdf(data)
  ? await readPdfFiling(data, JSON.parse(readFileSync(transcript ?? "", "utf8")), opt("--by") ?? "unknown")
  : readFiling(data, basename(file));
const { filing } = read;
console.log(`${filing.format} ${filing.scope} ${filing.companyName} (${filing.currency}, ${filing.standard}), years ${filing.periods.map((p) => `${p.periodEnd} (${p.months} m)`).join(", ")}`);
for (const p of filing.periods) console.log(`  ${p.periodEnd}: ${Object.entries(p.figures).map(([k, v]) => `${k} ${Math.round((v?.value ?? 0) / 1000).toLocaleString("en-US")}k`).join(", ")}`);
const result = await storeFiling({
  entityId,
  filing,
  sha256: read.sha256,
  extension: read.kind.extension,
  contentType: read.kind.contentType,
  fileName: basename(file),
  original: { data },
  enteredBy: process.env["USERNAME"] ?? process.env["USER"] ?? "script",
  force: args.includes("--force"),
  dryRun: !args.includes("--write"),
});
console.log(`${result.dryRun ? "dry run: would store" : "stored"} ${result.stored.join(", ") || "nothing"}${result.kept.length ? `; kept (a more recent report has them): ${result.kept.map((k) => k.period).join(", ")}` : ""}${result.replaced.length ? `; replaced ${result.replaced.join(", ")}` : ""}; ${result.key}`);
if (result.checks.length) console.log(`checks: ${result.checks.join("; ")}`);
