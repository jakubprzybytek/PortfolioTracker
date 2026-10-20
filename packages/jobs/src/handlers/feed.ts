// The cash-flow feed for a spreadsheet (IMPORTDATA): GET /feeds/cash-flows.csv?year=2026&token=…, the one route
// without a Cognito login. The token is made in the app (POST /feed-token) and checked here against its stored hash;
// a missing, wrong or revoked token gets the same bare 404. This function can only read the transactions and FX rates
// and record when the token was last used (IAM in sst.config.ts); it never logs the token.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { addDays, cashFlows, cashFlowsCsv, Repository, today, type FxHistory } from "@portfolio/core";
import { FEED_TOKEN_SETTING, shouldTouch, tokenMatches, type FeedToken } from "../lib/feedToken.ts";

// Not linked (a link grants every action on a table): the names come from the environment, the rights from `permissions`.
const repo = new Repository({
  market: process.env["MARKET_TABLE"] ?? "",
  transactions: process.env["TRANSACTIONS_TABLE"] ?? "",
  holdings: "",
});

const plain = (statusCode: number, body: string, type = "text/plain"): APIGatewayProxyResultV2 => ({ statusCode, headers: { "content-type": type, "cache-control": "no-store" }, body });
const notFound = plain(404, "Not found");

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const q = event.queryStringParameters ?? {};
  try {
    const stored = await repo.getSetting<FeedToken>(FEED_TOKEN_SETTING);
    if (!tokenMatches(q["token"], stored)) return notFound;
    const year = q["year"] ?? today().slice(0, 4);
    if (!/^\d{4}$/.test(year)) return plain(400, "year: four digits");

    const txs = await repo.listTransactions();
    const report = cashFlows(txs, Number(year), await fxOf(txs));
    if (shouldTouch(stored!)) await repo.setSettingField(FEED_TOKEN_SETTING, "lastUsedAt", new Date().toISOString());
    console.log(JSON.stringify({ feed: "cash-flows", year, accounts: report.accounts.length, missingRates: report.missingRates?.length ?? 0 }));
    return plain(200, cashFlowsCsv(report), "text/csv; charset=utf-8");
  } catch (e) {
    console.error("feed failed", (e as Error).name, (e as Error).message);
    return plain(500, "Error");
  }
}

/** NBP rates of the currencies deposited or withdrawn in, from a fortnight before the first such transaction. */
async function fxOf(txs: { date: string; type: string; currency: string }[]): Promise<FxHistory> {
  const flows = txs.filter((t) => (t.type === "DEPOSIT" || t.type === "WITHDRAWAL") && t.currency && t.currency !== "PLN");
  const first = flows.map((t) => t.date).sort()[0];
  if (!first) return new Map();
  const currencies = [...new Set(flows.map((t) => t.currency))];
  return new Map(await Promise.all(currencies.map(async (c) => [c, (await repo.queryFxRates(c, addDays(first, -14), today())).sort((a, b) => a.date.localeCompare(b.date))] as const)));
}
