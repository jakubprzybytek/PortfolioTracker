// CatalystViewer's issuer data into the Catalyst module (Docs/catalyst-phase2-plan.md, N5), read only on CatalystViewer.
// A dry run unless --write; dev first, a review of the report, then prod with the owner's approval.
//
// 1. Companies: CatalystViewer's identities (all confirmed there) point the listed names at their companies; a company
//    the module doesn't hold yet is made from GLEIF; a financing vehicle gets its group (`financialsEntityId`).
// 2. Profiles: industry, business summary and website; CatalystViewer's lenders' kinds and its rule-set override.
// 3. Reports: every original in its Filings bucket, read again here (never downloaded from the sources again); a PDF
//    from a transcript rebuilt from its stored lines and checked against the PDF (filings/rebuild.ts). Each year is
//    compared with CatalystViewer's row.
// 4. Known answers (its check-filings/expected.json).
// 5. Its AI analyses as judgements, their figures as collected figures, both marked as CatalystViewer's.
// 6. AI analysis switched on for every company with reports or an analysis there (not one you switched off).
//
//   npx sst shell --stage dev -- node scripts/catalyst-migrate-cv.ts --cv-profiles <…IssuerProfilesTable…> \
//     --cv-financials <…IssuerFinancialsTable…> --cv-bucket <…filingsbucket…> [--expected <path>] [--write]

import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Resource } from "sst";
import { CatalystRepository, entityIdOf, knownDifferences, leiRecords, shortName, type CatalystEntityItem, type CatalystNameItem, type FinancialYear } from "@portfolio/core/catalyst/index";
import { isPdf, readFiling, readPdfFiling, readPdfPages, rebuildTranscript, type ReadFiling } from "@portfolio/core/catalyst/filings/index";
import { financeRuleSetFor } from "@portfolio/core/catalyst/issuers/index";
import { storeFiling } from "../packages/jobs/src/catalyst/filings.ts";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cvProfiles = opt("--cv-profiles");
const cvFinancials = opt("--cv-financials");
const cvBucket = opt("--cv-bucket");
const expectedPath = opt("--expected") ?? "../CatalystViewer/scripts/check-filings/expected.json";
const write = args.includes("--write");
if (!cvProfiles || !cvFinancials || !cvBucket) throw new Error("usage: --cv-profiles <table> --cv-financials <table> --cv-bucket <bucket> [--expected <path>] [--write]");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const repo = new CatalystRepository(() => Resource.Catalyst.name);
const now = new Date().toISOString();
const SETUP = "CatalystViewer migration";
const report: Record<string, string[]> = {};
const note = (section: string, line: string) => {
  report[section] ??= [];
  report[section].push(line);
};

const scan = async <T>(table: string) => {
  const out: T[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey: start }));
    out.push(...((page.Items ?? []) as T[]));
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
};
type CvProfile = { issuerName: string; recordType: string; entityId?: string; financialsEntityId?: string; lei?: string; source?: string; status?: string; industry?: string; businessSummary?: string; websiteUrl?: string; modelId?: string; performedAt?: string; reportMarkdown?: string; scorecard?: unknown; agentFinancials?: { currency?: string; unit?: string; notes?: string; years?: Record<string, unknown>[] } };
type CvRow = FinancialYear & { issuerName: string; linesExtraction?: { model: string } };
const [profiles, cvRows] = await Promise.all([scan<CvProfile>(cvProfiles), scan<CvRow>(cvFinancials)]);
const identities = profiles.filter((p) => p.recordType === "#IDENTITY" && p.entityId);

// ─── 1. Companies and names ─────────────────────────────────────────────────────────────────────────────────────
const entities = new Map((await repo.listEntities()).map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...e }) => [e.entityId, e as Omit<CatalystEntityItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">]));
const changed = new Set<string>();
// Only the companies reports or analyses need (and a financing vehicle's group): not municipalities or the State,
// whose identities CatalystViewer also kept.
const analysed = new Set(profiles.filter((p) => p.reportMarkdown).map((p) => p.issuerName));
const needed = new Set([
  ...cvRows.map((r) => r.entityId),
  ...identities.filter((i) => analysed.has(i.issuerName)).map((i) => i.entityId!),
  ...identities.filter((i) => i.financialsEntityId && i.financialsEntityId !== i.entityId).flatMap((i) => [i.entityId!, i.financialsEntityId!]),
]);
// A company by its LEI: the id's own, or the one CatalystViewer's identity holds for a KRS id.
const leiOf = (id: string) => (id.startsWith("LEI:") ? id.slice(4) : identities.find((i) => i.entityId === id && i.lei)?.lei);
const missingLeis = [...needed].filter((id) => !entities.has(id)).map(leiOf).filter((l): l is string => Boolean(l));
const fetcher = (url: string) => fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (portfolio-tracker, personal use)" } });
for (const record of (await leiRecords(fetcher, missingLeis)).values()) {
  const id = entityIdOf(record);
  entities.set(id, { entityId: id, shortName: shortName(record.legalName), legalName: record.legalName, country: record.country, krs: null, lei: record.lei, leiStatus: record.leiStatus, status: record.status, legalForm: record.legalForm, createdAt: now, updatedAt: now });
  changed.add(id);
  note("companies", `made from GLEIF: ${record.legalName} (${id})`);
}
for (const id of needed) if (!entities.has(id)) note("companies", `not in the module and not in GLEIF: ${id}`);

const names = new Map((await repo.listNames()).map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...n }) => [n.name, n as Omit<CatalystNameItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">]));
const namesChanged: Omit<CatalystNameItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[] = [];
for (const i of identities) {
  if (!entities.has(i.entityId!)) continue;
  const before = names.get(i.issuerName);
  if (before?.entityId && before.entityId !== i.entityId) {
    note("names", `${i.issuerName}: the module links it to ${before.entityId}, CatalystViewer to ${i.entityId}: left for you`);
    continue;
  }
  if (before?.entityId === i.entityId && before?.status === "confirmed") continue;
  namesChanged.push({ ...before, name: i.issuerName, entityId: i.entityId!, status: "confirmed", evidence: `${before?.evidence ? `${before.evidence}; ` : ""}confirmed in CatalystViewer (${i.source ?? "?"})`, updatedAt: now });
  if (i.financialsEntityId && i.financialsEntityId !== i.entityId) {
    const vehicle = entities.get(i.entityId!)!;
    entities.set(vehicle.entityId, { ...vehicle, financialsEntityId: i.financialsEntityId, updatedAt: now });
    changed.add(vehicle.entityId);
    note("companies", `${vehicle.shortName}: judged on the reports of ${entities.get(i.financialsEntityId)?.shortName ?? i.financialsEntityId} (financing vehicle)`);
  }
}
note("names", `${namesChanged.length} names confirmed or linked as in CatalystViewer`);

// ─── 2. Profiles, lenders, overrides ─────────────────────────────────────────────────────────────────────────────
const entityOfName = new Map(identities.map((i) => [i.issuerName, i.entityId!]));
for (const p of profiles.filter((x) => x.recordType === "#PROFILE")) {
  const id = entityOfName.get(p.issuerName);
  const e = id ? entities.get(id) : undefined;
  if (!e) continue;
  const next = { ...e };
  if (p.industry && !e.industry) next.industry = p.industry;
  if (p.businessSummary && !e.businessSummary) next.businessSummary = p.businessSummary;
  if (p.websiteUrl && !e.website) next.website = p.websiteUrl;
  const kind = financeRuleSetFor(p.issuerName);
  if (kind && !e.financeRuleSet) next.financeRuleSet = kind;
  if (p.issuerName === "AB S.A." && !e.ruleSetOverride) next.ruleSetOverride = { ruleSet: "general", reason: "An IT distributor classified Retail: it holds stock on its own money, unlike a shop (CatalystViewer)" };
  if (JSON.stringify(next) !== JSON.stringify(e)) {
    entities.set(e.entityId, { ...next, updatedAt: now });
    changed.add(e.entityId);
  }
}
note("profiles", `${[...changed].length} companies get an industry, a summary, a website, a lender's kind or an override`);

// ─── 3. Reports ─────────────────────────────────────────────────────────────────────────────────────────────────
// Companies first: a report is stored only for a company the module holds.
if (write) await repo.putEntities([...changed].map((id) => entities.get(id)!));
if (write) await repo.putNames(namesChanged);
const keys: string[] = [];
let token: string | undefined;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: cvBucket, Prefix: "filings/", ContinuationToken: token }));
  keys.push(...(page.Contents ?? []).map((o) => o.Key!).filter((k) => !k.endsWith("/")));
  token = page.NextContinuationToken;
} while (token);
const years = new Set<string>();
for (const key of keys.sort()) {
  const entityId = key.split("/")[1]!.replace(/^LEI-/, "LEI:");
  if (!entities.has(entityId)) {
    note("reports", `✗ ${key}: company not in the module`);
    continue;
  }
  if (!write && changed.has(entityId) && !(await repo.getEntity(entityId))) {
    note("reports", `(dry run) ${key}: its company is made with --write first`);
    continue;
  }
  const data = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: cvBucket, Key: key }))).Body!.transformToByteArray());
  const theirs = cvRows.filter((r) => r.entityId === entityId && r.filing.key === key);
  try {
    let read: ReadFiling;
    if (isPdf(data)) {
      const { transcript, unmatched } = rebuildTranscript(theirs, await readPdfPages(data));
      if (unmatched.length) note("reports", `${key}: ${unmatched.length} stored lines not found on their pages (left out): ${unmatched.slice(0, 3).join("; ")}`);
      const model = theirs[0]?.filing.extraction?.model ?? theirs[0]?.linesExtraction?.model ?? "a model";
      read = await readPdfFiling(data, transcript, `CatalystViewer transcript (${model}), rebuilt`);
    } else read = readFiling(data, key);
    const result = await storeFiling({ entityId, filing: read.filing, sha256: read.sha256, extension: read.kind.extension, contentType: read.kind.contentType, fileName: key.split("/").pop()!, original: { data }, enteredBy: SETUP, force: true, dryRun: !write });
    for (const p of [...result.stored, ...result.kept.map((k) => k.period)]) years.add(`${entityId}#${p}`);
    for (const p of read.filing.periods) {
      const cv = theirs.find((r) => r.period === `${p.periodEnd}#${read.filing.scope}`);
      if (!cv) continue;
      const diff = knownDifferences(Object.fromEntries(Object.entries(cv.figures).map(([k, v]) => [k, Math.round((v?.value ?? 0) / 1000)])), p.figures);
      if (diff.length) note("reports", `≠ ${key} ${p.periodEnd}: ${diff.join("; ")} (ours ≠ CatalystViewer's)`);
    }
    if (result.checks.length) note("reports", `${key}: checks: ${result.checks.join("; ")}`);
  } catch (err) {
    note("reports", `✗ ${key}: ${(err as Error).message.split("\n")[0]}`);
  }
}
note("reports", `${keys.length} files; ${years.size} years of ${new Set([...years].map((y) => y.split("#")[0])).size} companies ${write ? "stored" : "to store"}`);

// ─── 4. Known answers ───────────────────────────────────────────────────────────────────────────────────────────
type Expected = { entityId: string; period: string; file: string; currency: string; thousands: Record<string, number> };
const expected = JSON.parse(readFileSync(expectedPath, "utf8")) as { checkedOn: string; reports: Expected[] };
const known = expected.reports.filter((r) => entities.has(r.entityId)).map((r) => ({ entityId: r.entityId, period: r.period, currency: r.currency, thousands: r.thousands, file: r.file, checkedOn: expected.checkedOn, source: "CatalystViewer scripts/check-filings/expected.json" }));
if (write) await repo.putKnown(known);
note("known answers", `${known.length} of ${expected.reports.length}`);

// ─── 5. Analyses and their figures ──────────────────────────────────────────────────────────────────────────────
const analyses = profiles.filter((p) => p.reportMarkdown && (p.recordType.startsWith("#ANALYSIS#") || p.recordType === "#LATEST_ANALYSIS"));
const seen = new Set<string>();
const judgements = [];
const figures = [];
for (const a of analyses) {
  const id = entityOfName.get(a.issuerName);
  if (!id || !entities.has(id) || !a.performedAt || seen.has(`${id}#${a.performedAt}`)) continue;
  seen.add(`${id}#${a.performedAt}`);
  const by = `CatalystViewer (${(a.modelId ?? "a model").split("/").pop()})`;
  judgements.push({ entityId: id, at: a.performedAt, markdown: a.reportMarkdown!, by, ...(a.scorecard ? { scorecard: a.scorecard } : {}), source: "CatalystViewer" as const });
  if (a.agentFinancials?.years?.length)
    figures.push({ entityId: id, at: a.performedAt, currency: a.agentFinancials.currency ?? "PLN", unit: a.agentFinancials.unit ?? "millions", ...(a.agentFinancials.notes ? { notes: a.agentFinancials.notes } : {}), years: a.agentFinancials.years, by, source: "CatalystViewer" as const });
}
if (write) {
  await repo.putAnalyses(judgements);
  await repo.putCollectedFigures(figures);
}
note("analyses", `${judgements.length} judgements of ${new Set(judgements.map((j) => j.entityId)).size} companies, ${figures.length} sets of collected figures`);

// ─── 6. AI analysis on for CatalystViewer's companies ──────────────────────────────────────────────────────────
// Companies with reports (as the owner asked); those with only an analysis there stay off until switched on.
const withData = new Set([...years].map((y) => y.split("#")[0]!));
const switched = [...withData].map((id) => entities.get(id)!).filter((e) => e && !e.aiAnalysis);
if (write) await repo.putEntities(switched.map((e) => ({ ...e, aiAnalysis: { on: true, by: "setup: CatalystViewer's companies", at: now }, updatedAt: now })));
note("AI analysis", `switched on for ${switched.length} companies: ${switched.map((e) => e.shortName).join(", ")}`);

for (const [section, lines] of Object.entries(report)) {
  console.log(`\n## ${section}`);
  for (const l of lines) console.log(`  ${l}`);
}
console.log(write ? "\nwritten" : "\ndry run: nothing written (--write to store)");
