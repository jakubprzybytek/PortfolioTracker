// Imports CatalystViewer's bid/ask history into the Catalyst table (Docs/catalyst-phase1-plan.md, M8): its
// BondStatistics table (read only) holds, per bond, market and month, the day's quote as CatalystViewer last saw it
// during the session (three snapshots a day, the last at 16:00 Warsaw time), since 2023. The quotes pages show only the
// current session, so this is the only bid/ask history there is. Stored as end-of-session quotes (`Q#<date>#<market>`)
// with source "catalystviewer", only for days before the module's own quotes, never over them; bonds by code (the
// module's bonds since 2020, ended ones too). A dry run unless --write. Run inside the target stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-import-cv.ts --cv-table <catalyst-viewer-prod-BondStatisticsTable-…> [--write]

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { CatalystRepository, type CatalystQuoteItem } from "@portfolio/core/catalyst/index";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const cvTable = opt("--cv-table");
const write = args.includes("--write");
if (!cvTable) throw new Error("usage: node scripts/catalyst-import-cv.ts --cv-table <CatalystViewer's BondStatistics table> [--write]");

const SOURCE = "catalystviewer";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const repo = new CatalystRepository(() => Resource.Catalyst.name);

interface CvQuote {
  date: number;
  bid?: number;
  ask?: number;
  close?: number;
  transactions?: number;
}
interface CvItem {
  name: string;
  market: string;
  quotes?: Record<string, CvQuote>;
}

// The first day of the module's own quotes: CatalystViewer's fill only the days before it.
const firstOwn = await doc
  .send(new QueryCommand({ TableName: Resource.Catalyst.name, KeyConditionExpression: "PK = :p", ExpressionAttributeValues: { ":p": "QUOTEDAYS" }, Limit: 1 }))
  .then((r) => (r.Items?.[0]?.["date"] as string | undefined) ?? "9999-12-31");
const isinByCode = new Map((await repo.listBonds()).map((b) => [b.code, b.isin]));
console.log(`target ${Resource.Catalyst.name}: ${isinByCode.size} bonds; own quotes from ${firstOwn}`);

const quotes: Omit<CatalystQuoteItem, "PK" | "SK">[] = [];
const unknown = new Set<string>();
let items = 0;
let days = 0;
let ExclusiveStartKey: Record<string, unknown> | undefined;
do {
  const page = await doc.send(new ScanCommand({ TableName: cvTable, ExclusiveStartKey }));
  for (const item of (page.Items ?? []) as CvItem[]) {
    items++;
    const isin = isinByCode.get(item.name);
    if (!isin) {
      unknown.add(item.name);
      continue;
    }
    for (const [date, q] of Object.entries(item.quotes ?? {})) {
      days++;
      if (date >= firstOwn || (q.bid === undefined && q.ask === undefined)) continue;
      quotes.push({
        isin,
        date,
        market: item.market,
        ...(q.bid !== undefined ? { bid: { price: q.bid, volume: 0, orders: 0 } } : {}),
        ...(q.ask !== undefined ? { ask: { price: q.ask, volume: 0, orders: 0 } } : {}),
        trades: q.transactions ?? 0,
        source: SOURCE,
        // When CatalystViewer saved it; some quotes have no time: the day itself.
        fetchedAt: Number.isFinite(new Date(q.date).getTime()) ? new Date(q.date).toISOString() : `${date}T00:00:00.000Z`,
      });
    }
  }
  ExclusiveStartKey = page.LastEvaluatedKey;
} while (ExclusiveStartKey);

const dates = quotes.map((q) => q.date).sort();
console.log(`${items} bond-months read, ${days} days; ${quotes.length} quotes with a bid or an ask to store (${dates[0] ?? "–"} – ${dates.at(-1) ?? "–"})`);
console.log(`${unknown.size} codes not in the module (${[...unknown].slice(0, 10).join(", ")}${unknown.size > 10 ? " …" : ""})`);
if (!write) console.log("dry run: nothing written (--write to store)");
else console.log(`written: ${await repo.putQuotes(quotes)}`);
