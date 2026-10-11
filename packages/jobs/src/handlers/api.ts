// HTTP API for the UI (see Docs/ui.md). Read-only. Every route needs a Cognito login (checked by API Gateway)
// in one of the stage's access groups (checked here).

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { addDays, today } from "@portfolio/core";
import { hasAnyGroup } from "../lib/access.ts";
import { repo } from "../lib/context.ts";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Comma-separated, set per stage in sst.config.ts (accessGroups). */
const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  if (!hasAnyGroup(event.requestContext.authorizer?.jwt?.claims, ACCESS_GROUPS)) return json(403, { error: "This account has no access" });
  const route = event.routeKey; // e.g. "GET /holdings"
  const q = event.queryStringParameters ?? {};
  const isin = event.pathParameters?.["isin"];
  const from = q["from"] ?? addDays(today(), -365);
  const to = q["to"] ?? today();

  try {
    switch (route) {
      case "GET /holdings": {
        const snap = await repo.getSnapshot("LATEST");
        return snap ? json(200, snap) : json(404, { error: "No valuation yet" });
      }
      case "GET /portfolio/history": {
        const snaps = await repo.querySnapshots(from, to);
        return json(
          200,
          snaps.map((s) => ({ date: s.date, totals: s.totals, byType: s.byType })),
        );
      }
      case "GET /instruments": {
        const items = (await repo.listInstruments()).filter((i) => i.isin !== "MF-TERMS");
        const withStatus = await Promise.all(items.map(async (i) => ({ ...i, backfill: await repo.getBackfillStatus(i.isin) })));
        return json(200, withStatus);
      }
      case "GET /instruments/{isin}/prices": {
        if (!isin || !ISIN.test(isin)) return json(400, { error: "Invalid ISIN" });
        const inst = await repo.getInstrument(isin);
        if (!inst) return json(404, { error: "Unknown instrument" });
        const prices = await repo.queryPrices(isin, inst.venue, from, to);
        return json(200, prices.map(({ PK: _p, SK: _s, ...rest }) => rest));
      }
      case "GET /transactions": {
        // All transactions, newest first, with the instrument's code, name and type (none for cash movements).
        const [txs, instruments] = await Promise.all([repo.listTransactions(), repo.listInstruments()]);
        const byIsin = new Map(instruments.map((i) => [i.isin, i]));
        const rows = txs.map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...rest }) => {
          const inst = rest.isin ? byIsin.get(rest.isin) : undefined;
          return { ...rest, instrument: inst ? { code: inst.code, name: inst.name, type: inst.type } : null };
        });
        rows.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
        return json(200, rows);
      }
      case "GET /instruments/{isin}/transactions": {
        if (!isin || !ISIN.test(isin)) return json(400, { error: "Invalid ISIN" });
        const txs = (await repo.listTransactions()).filter((t) => t.isin === isin);
        return json(200, txs.map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...rest }) => rest));
      }
      case "GET /status": {
        const jobs = ["eod-gpw", "eod-gpw-recheck", "valuation", "backfill", "import", "monthly"];
        const runs = Object.fromEntries(await Promise.all(jobs.map(async (j) => [j, (await repo.listJobRuns(j))[0] ?? null])));
        return json(200, { now: new Date().toISOString(), jobs: runs });
      }
      default:
        return json(404, { error: `No route ${route}` });
    }
  } catch (err) {
    console.error(err);
    return json(500, { error: (err as Error).message });
  }
}
