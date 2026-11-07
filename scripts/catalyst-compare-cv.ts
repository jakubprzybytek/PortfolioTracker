// Compares the Catalyst module with CatalystViewer bond by bond (Docs/catalyst-phase1-plan.md, M8), read only on both:
// CatalystViewer's active bonds (its BondDetails table) against the module's listed bonds, terms and screen rows.
// Checked: the bonds each knows, maturity, nominal, issuer, coupon margin, issue value, and the liquidity measures
// (CatalystViewer: share of business days traded and average turnover over 30 calendar days, average spread; the
// module: share of the last 30 sessions traded, median turnover, median spread). Run inside the stage's shell:
//
//   npx sst shell --stage prod -- node scripts/catalyst-compare-cv.ts --cv-table <catalyst-viewer-prod-BondDetailsTable-…> [--list]

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { CatalystRepository } from "@portfolio/core/catalyst/index";

const args = process.argv.slice(2);
const i = args.indexOf("--cv-table");
const cvTable = i >= 0 ? args[i + 1] : undefined;
const list = args.includes("--list");
if (!cvTable) throw new Error("usage: node scripts/catalyst-compare-cv.ts --cv-table <CatalystViewer's BondDetails table> [--list]");

interface CvBond {
  name: string;
  market: string;
  isin: string;
  issuer?: string;
  bondStatus?: string;
  maturityDay?: string;
  nominalValue?: number;
  interestConst?: number;
  interestVariable?: string;
  issueValue?: number;
  issuedNominal?: number;
  tradingDaysRatio?: number;
  averageTurnover?: number;
  averageSpread?: number;
}

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const repo = new CatalystRepository(() => Resource.Catalyst.name);

const cv: CvBond[] = [];
let ExclusiveStartKey: Record<string, unknown> | undefined;
do {
  const page = await doc.send(new ScanCommand({ TableName: cvTable, FilterExpression: "bondStatus = :a", ExpressionAttributeValues: { ":a": "active" }, ExclusiveStartKey }));
  cv.push(...((page.Items ?? []) as CvBond[]));
  ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

const [bonds, terms, screen] = await Promise.all([repo.listBonds(), repo.listTerms(), repo.listScreen()]);
const bondBy = new Map(bonds.map((b) => [b.isin, b]));
const termsBy = new Map(terms.map((t) => [t.isin, t]));
const screenBy = new Map(screen.map((s) => [s.isin, s]));
const cvBy = new Map<string, CvBond>();
// A bond on two markets is two CatalystViewer records: the GPW one.
for (const b of cv) if (!cvBy.has(b.isin) || b.market.startsWith("GPW")) cvBy.set(b.isin, b);

const listed = bonds.filter((b) => b.status === "listed");
const onlyCv = [...cvBy.values()].filter((b) => bondBy.get(b.isin)?.status !== "listed");
const onlyPt = listed.filter((b) => !cvBy.has(b.isin));
console.log(`CatalystViewer: ${cvBy.size} active bonds; the module: ${listed.length} listed; in both: ${listed.length - onlyPt.length}`);
console.log(`only in CatalystViewer: ${onlyCv.length} (${onlyCv.slice(0, 8).map((b) => `${b.name} [${bondBy.get(b.isin)?.status ?? "unknown"}]`).join(", ")})`);
console.log(`only in the module: ${onlyPt.length} (${onlyPt.slice(0, 8).map((b) => b.code).join(", ")})`);

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, "");
const diffs: Record<string, string[]> = { maturity: [], nominal: [], issuer: [], margin: [], issueValue: [] };
const liq: { code: string; cvShare: number; ptShare: number; cvTurnover: number; ptTurnover: number | null; cvSpread: number | null; ptSpread: number | null }[] = [];
for (const [isin, c] of cvBy) {
  const b = bondBy.get(isin);
  if (b?.status !== "listed") continue;
  const t = termsBy.get(isin);
  const s = screenBy.get(isin);
  if (c.maturityDay && b.maturity && c.maturityDay !== b.maturity) diffs["maturity"]!.push(`${b.code} ${c.maturityDay} vs ${b.maturity}`);
  if (c.nominalValue !== undefined && b.nominal !== null && Math.abs(c.nominalValue - b.nominal) > 0.01) diffs["nominal"]!.push(`${b.code} ${c.nominalValue} vs ${b.nominal}`);
  if (t?.issuer && c.issuer && norm(t.issuer) !== norm(c.issuer)) diffs["issuer"]!.push(`${b.code} "${c.issuer}" vs "${t.issuer}"`);
  if (t?.coupon.kind === "FLOATING" && c.interestConst !== undefined && Math.abs(c.interestConst / 100 - (t.coupon.margin ?? 0)) > 1e-6) diffs["margin"]!.push(`${b.code} ${c.interestConst} % vs ${((t.coupon.margin ?? 0) * 100).toFixed(2)} %`);
  if (t?.issueValue && c.issueValue && Math.abs(t.issueValue.amount - c.issueValue) / c.issueValue > 0.01) diffs["issueValue"]!.push(`${b.code} ${c.issueValue} vs ${t.issueValue.amount}`);
  if (s && c.tradingDaysRatio !== undefined)
    liq.push({ code: b.code, cvShare: c.tradingDaysRatio, ptShare: s.liquidity.traded30, cvTurnover: (c.averageTurnover ?? 0) * 1000, ptTurnover: s.liquidity.medianTurnover30, cvSpread: c.averageSpread ?? null, ptSpread: s.liquidity.medianSpread30 });
}
for (const [k, v] of Object.entries(diffs)) console.log(`${k}: ${v.length} differ${v.length ? ` (${v.slice(0, list ? v.length : 5).join("; ")})` : ""}`);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const corr = (xs: number[], ys: number[]) => {
  const mx = mean(xs);
  const my = mean(ys);
  const num = xs.reduce((s, x, k) => s + (x - mx) * (ys[k]! - my), 0);
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return den ? num / den : NaN;
};
const shares = liq.map((l) => [l.cvShare, l.ptShare] as const);
console.log(`liquidity, ${liq.length} bonds: share traded, mean |difference| ${mean(shares.map(([a, b]) => Math.abs(a - b))).toFixed(3)}, correlation ${corr(shares.map((x) => x[0]), shares.map((x) => x[1])).toFixed(3)}`);
const turn = liq.filter((l) => l.ptTurnover !== null && l.cvTurnover > 0);
console.log(`turnover (CatalystViewer's 30-day average vs the module's median of traded sessions), ${turn.length} bonds: correlation of logs ${corr(turn.map((l) => Math.log(l.cvTurnover)), turn.map((l) => Math.log(l.ptTurnover!))).toFixed(3)}`);
const spr = liq.filter((l) => l.cvSpread !== null && l.ptSpread !== null);
console.log(`spread, ${spr.length} bonds: mean |difference| ${mean(spr.map((l) => Math.abs(l.cvSpread! - l.ptSpread!))).toFixed(3)} pp, correlation ${corr(spr.map((l) => l.cvSpread!), spr.map((l) => l.ptSpread!)).toFixed(3)}`);
const far = liq.filter((l) => Math.abs(l.cvShare - l.ptShare) > 0.3);
console.log(`share traded differs by more than 0.3: ${far.length}${far.length ? ` (${far.slice(0, list ? far.length : 8).map((l) => `${l.code} ${l.cvShare} vs ${l.ptShare}`).join("; ")})` : ""}`);
