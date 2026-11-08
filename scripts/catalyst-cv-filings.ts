// CatalystViewer's reports into the module (Docs/catalyst-phase2-plan.md, N3 on dev, N5 on prod): every original in
// its Filings bucket (read only) is read again here with the ported parsers and stored for its company, never
// downloaded from the sources again; each year is compared with CatalystViewer's stored row. Its hand-read figures
// (scripts/check-filings/expected.json) become known answers. PDFs need their transcripts: left for N5. A dry run
// unless --write. Inside the target stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-cv-filings.ts --cv-bucket <catalyst-viewer-prod-filingsbucket-…> --cv-table <…IssuerFinancialsTable…> [--expected <path>] [--write]

import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { CatalystRepository, knownDifferences } from "@portfolio/core/catalyst/index";
import type { FilingField, SourcedFigure } from "@portfolio/core/catalyst/filings/index";
import { isPdf, readFiling } from "@portfolio/core/catalyst/filings/index";
import { storeFiling } from "../packages/jobs/src/catalyst/filings.ts";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cvBucket = opt("--cv-bucket");
const cvTable = opt("--cv-table");
const expectedPath = opt("--expected") ?? "../CatalystViewer/scripts/check-filings/expected.json";
const write = args.includes("--write");
if (!cvBucket || !cvTable) throw new Error("usage: --cv-bucket <CatalystViewer's Filings bucket> --cv-table <its IssuerFinancials table> [--expected <path>] [--write]");

const s3 = new S3Client({});
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const repo = new CatalystRepository(() => Resource.Catalyst.name);

// CatalystViewer's rows, to compare with.
type CvRow = { entityId: string; period: string; figures: Partial<Record<FilingField, SourcedFigure>>; filing: { key: string; format: string } };
const cvRows: CvRow[] = [];
let start: Record<string, unknown> | undefined;
do {
  const page = await doc.send(new ScanCommand({ TableName: cvTable, ProjectionExpression: "entityId, period, figures, filing", ExclusiveStartKey: start }));
  cvRows.push(...((page.Items ?? []) as CvRow[]));
  start = page.LastEvaluatedKey;
} while (start);

const keys: string[] = [];
let token: string | undefined;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: cvBucket, Prefix: "filings/", ContinuationToken: token }));
  keys.push(...(page.Contents ?? []).map((o) => o.Key!).filter((k) => !k.endsWith("/")));
  token = page.NextContinuationToken;
} while (token);

const entities = new Set((await repo.listEntities()).map((e) => e.entityId));
const pdfs: string[] = [];
const missing = new Set<string>();
/** Distinct company years (a year shown by two reports is written twice: the newer report's version stays). */
const years = new Set<string>();
const companies = new Set<string>();
let differing = 0;
for (const key of keys.sort()) {
  // filings/<entityId, ":" as "-">/<period end>-<scope>-<sha12>.<ext>
  const entityId = key.split("/")[1]!.replace(/^LEI-/, "LEI:");
  if (!entities.has(entityId)) {
    missing.add(entityId);
    continue;
  }
  const data = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: cvBucket, Key: key }))).Body!.transformToByteArray());
  if (isPdf(data)) {
    pdfs.push(key);
    continue;
  }
  try {
    const read = readFiling(data, key);
    const result = await storeFiling({ entityId, filing: read.filing, sha256: read.sha256, extension: read.kind.extension, contentType: read.kind.contentType, fileName: key.split("/").pop()!, original: { data }, enteredBy: "CatalystViewer (re-read)", force: true, dryRun: !write });
    for (const period of [...result.stored, ...result.kept.map((k) => k.period)]) years.add(`${entityId}#${period}`);
    companies.add(entityId);
    // Each year against CatalystViewer's row from the same file.
    for (const p of read.filing.periods) {
      const cv = cvRows.find((r) => r.entityId === entityId && r.period === `${p.periodEnd}#${read.filing.scope}` && r.filing.key === key);
      if (!cv) continue;
      const thousands = Object.fromEntries(Object.entries(cv.figures).map(([k, v]) => [k, Math.round((v?.value ?? 0) / 1000)]));
      const diff = knownDifferences(thousands, p.figures);
      if (diff.length) {
        differing++;
        console.log(`≠ ${key} ${p.periodEnd}: ${diff.join("; ")} (ours ≠ CatalystViewer's)`);
      }
    }
    console.log(`${write ? "stored" : "would store"} ${key}: ${result.stored.join(", ")}${result.kept.length ? `; kept ${result.kept.map((k) => k.period).join(", ")}` : ""}${result.checks.length ? `; checks: ${result.checks.length}` : ""}`);
  } catch (err) {
    console.log(`✗ ${key}: ${(err as Error).message.split("\n")[0]}`);
  }
}

// Known answers.
type Expected = { entityId: string; period: string; file: string; currency: string; thousands: Record<string, number> };
const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as { checkedOn: string; reports: Expected[] };
const known = expected.reports.filter((r) => entities.has(r.entityId)).map((r) => ({ entityId: r.entityId, period: r.period, currency: r.currency, thousands: r.thousands, file: r.file, checkedOn: expected.checkedOn, source: "CatalystViewer scripts/check-filings/expected.json" }));
if (write) await repo.putKnown(known);

console.log(`\n${keys.length} files; ${years.size} years of ${companies.size} companies ${write ? "stored" : "to store"}; ${differing} years differ from CatalystViewer's; ${pdfs.length} PDFs left for N5 (transcripts); companies not in the module: ${[...missing].join(", ") || "none"}; known answers: ${known.length} of ${expected.reports.length}${write ? "" : " (dry run: nothing written, --write to store)"}`);
