// Checks stored financial years against figures read by hand from the printed reports (the known answers), and a
// fresh read of each original with the current parsers (Docs/catalyst.md, "Reading reports"). Run after any parser
// change; exits with 1 when a figure differs. With --mark, a year that passes becomes "hand-checked". Inside the
// stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-filings-check.ts [--only <entityId>] [--mark]

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { CatalystRepository, knownDifferences, lineProblems, type FinancialYear } from "@portfolio/core/catalyst/index";
import { isPdf, readFiling } from "@portfolio/core/catalyst/filings/index";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const mark = args.includes("--mark");
const repo = new CatalystRepository(() => Resource.Catalyst.name);
const s3 = new S3Client({});

let failed = 0;
for (const k of (await repo.listKnown()).filter((x) => !only || x.entityId === only)) {
  const problems: string[] = [];
  const name = `${k.entityId} ${k.period}`;
  const [years, filings] = await Promise.all([repo.listYears(k.entityId), repo.listFilings(k.entityId)]);
  const row = years.find((y) => y.period === k.period) as FinancialYear | undefined;
  // The original the figures were read from: the filing whose SHA-256 starts as the known answer's file name says.
  const sha12 = /-([0-9a-f]{12})\.\w+$/.exec(k.file ?? "")?.[1];
  const filing = filings.find((f) => sha12 && f.sha256.startsWith(sha12));
  // The row may come from a more recent report (restated): then only the re-read is compared.
  const replaced = row && filing && row.filing.sha256 !== filing.sha256 && row.reportPeriodEnd > k.period.split("#")[0]!;
  if (!row) problems.push("stored: no row");
  else if (!replaced) problems.push(...knownDifferences(k.thousands, row.figures).map((d) => `stored: ${d}`), ...lineProblems(row.lines, row.figures).map((d) => `stored: ${d}`));
  let reread = "not re-read";
  if (!filing) problems.push("no original stored");
  else {
    const data = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: Resource.Files.name, Key: filing.key }))).Body!.transformToByteArray());
    if (isPdf(data)) reread = "not re-read (PDF: needs its transcript)";
    else {
      const period = readFiling(data, filing.key).filing.periods.find((p) => p.periodEnd === k.period.split("#")[0]);
      problems.push(...knownDifferences(k.thousands, period?.figures).map((d) => `re-read: ${d}`), ...lineProblems(period?.lines, period?.figures).map((d) => `re-read: ${d}`));
      reread = "re-read";
    }
  }
  if (problems.length) {
    failed++;
    console.log(`✗ ${name}\n    ${problems.join("\n    ")}`);
  } else {
    console.log(`✓ ${name}: ${replaced ? "stored row from a more recent report (not compared)" : "stored"}, ${reread}`);
    if (mark && row && !replaced && row.review.status !== "hand-checked") {
      const { PK: _p, SK: _s, ...rest } = row as FinancialYear & { PK: string; SK: string };
      await repo.putYears([{ ...rest, review: { status: "hand-checked", note: "known answer", at: new Date().toISOString(), by: "catalyst-filings-check" } }]);
    }
  }
}
console.log(failed ? `\n${failed} year(s) differ from the known answers` : "\nAll years match the known answers");
process.exit(failed ? 1 : 0);
