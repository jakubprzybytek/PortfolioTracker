// Compares each company's scorecard with CatalystViewer's (Docs/catalyst-phase2-plan.md, N4), read only on both: the
// scorecard from the module's stored years against the one CatalystViewer's rows give, both with CatalystViewer's
// industry for the company (the module has no industries until N5), dimension by dimension, metric by metric.
// Refinancing differs by design (fresher bond data) and is left out; Financial trend is compared with the arrows.
//
//   npx sst shell --stage dev -- node scripts/catalyst-compare-cv-scorecards.ts --cv-profiles <…IssuerProfilesTable…> --cv-financials <…IssuerFinancialsTable…>

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { CatalystRepository, type FinancialYear } from "@portfolio/core/catalyst/index";
import { companyAnalysis, filedYears, financeRuleSetFor, ruleSetFor, scorecardFromReportedYears } from "@portfolio/core/catalyst/issuers/index";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const cvProfiles = opt("--cv-profiles");
const cvFinancials = opt("--cv-financials");
if (!cvProfiles || !cvFinancials) throw new Error("usage: --cv-profiles <IssuerProfiles table> --cv-financials <IssuerFinancials table>");

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
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
type Profile = { issuerName: string; recordType: string; industry?: string; entityId?: string; financialsEntityId?: string };
const [profiles, cvRows] = await Promise.all([scan<Profile>(cvProfiles), scan<FinancialYear & { issuerName: string }>(cvFinancials)]);
const identities = profiles.filter((p) => p.recordType === "#IDENTITY");
const industryOf = new Map(profiles.filter((p) => p.recordType === "#PROFILE" && p.industry).map((p) => [p.issuerName, p.industry!]));

const repo = new CatalystRepository(() => Resource.Catalyst.name);
const entities = await repo.listEntities();
let same = 0;
let differ = 0;
for (const e of entities) {
  const years = (await repo.listYears(e.entityId)) as FinancialYear[];
  if (years.length === 0) continue;
  const cvNames = identities.filter((i) => (i.financialsEntityId ?? i.entityId) === e.entityId).map((i) => i.issuerName);
  const industry = cvNames.map((n) => industryOf.get(n)).find(Boolean);
  const ours = companyAnalysis(industry ? { industry } : {}, cvNames, years, [], {}, "2026-11-08");
  // CatalystViewer's: its rows, its rule set (by name), the same scoring code.
  const theirRows = cvRows.filter((r) => r.entityId === e.entityId);
  const lender = cvNames.some((n) => financeRuleSetFor(n));
  const filed = filedYears(theirRows, false);
  const ruleSet = cvNames.map((n) => ruleSetFor(industry, n)).find((r) => r !== "general") ?? ruleSetFor(industry);
  const theirs = filed ? scorecardFromReportedYears("", filed.years, ruleSet) : undefined;
  const problems: string[] = [];
  if (!theirs || !ours.scorecard) problems.push(`scored: ours ${ours.state}, CatalystViewer's ${theirs ? "scored" : "none"}${lender ? " (lender)" : ""}`);
  else {
    for (const d of theirs.dimensions) {
      if (d.name === "Financial Trend") {
        const arrows = ours.scorecard.dimensions.filter((x) => x.trend).map((x) => `${x.name} ${x.trend!.arrow}`);
        if (d.signal !== "na" && arrows.length === 0) problems.push(`trend ${d.signal} but no arrow`);
        continue;
      }
      const mine = ours.scorecard.dimensions.find((x) => x.name === d.name);
      if (!mine) problems.push(`${d.name}: missing`);
      else if (mine.signal !== d.signal) problems.push(`${d.name}: ${mine.signal} ≠ ${d.signal}`);
      else for (const m of d.metrics) {
        const v = mine.metrics.find((x) => x.name === m.name)?.value;
        if (v !== m.value && !(v != null && m.value != null && Math.abs(v - m.value) < 1e-9)) problems.push(`${d.name} ${m.name}: ${v} ≠ ${m.value}`);
      }
    }
  }
  if (problems.length) {
    differ++;
    console.log(`≠ ${e.shortName} (${e.entityId}, ${ours.ruleSet}): ${problems.join("; ")}`);
  } else {
    same++;
    console.log(`= ${e.shortName} (${ours.ruleSet}): ${ours.scorecard!.dimensions.map((d) => `${d.name} ${d.signal}${d.trend ? ` ${d.trend.arrow}` : ""}`).join(", ")}`);
  }
}
console.log(`\n${same} companies equal CatalystViewer's scorecard (refinancing aside), ${differ} differ`);
