// HTTP API for the UI (see Docs/ui.md). Read-only. Every route needs a Cognito login (checked by API Gateway)
// in one of the stage's access groups (checked here).

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { addDays, cpiIndicators, priceRows, retailValueHistory, today, type PriceItem } from "@portfolio/core";
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
        // Retail bonds aren't traded: their line is the calculated value per bond of your lots (nominal 100).
        if (inst.type === "BOND_RETAIL" && inst.retail) {
          const txs = (await repo.listTransactions()).filter((t) => t.isin === isin);
          const points = retailValueHistory(inst.retail, txs, from, to);
          return json(200, points.map((p) => ({ isin, venue: "CALC", date: p.date, close: p.value, traded: true, currency: inst.currency, calculated: true })));
        }
        const prices = await repo.queryPrices(isin, inst.venue, from, to);
        return json(200, prices.map(({ PK: _p, SK: _s, ...rest }) => rest));
      }
      case "GET /indicators": {
        // Small (a few hundred monthly points each): all series at once; the UI picks the range.
        return json(200, cpiIndicators(await repo.listReferenceIndex()));
      }
      case "GET /prices": {
        // Held instruments (latest snapshot): latest price, its date, and the price a year earlier.
        const [snap, instruments] = await Promise.all([repo.getSnapshot("LATEST"), repo.listInstruments()]);
        const held = new Set((snap?.holdings ?? []).filter((h) => h.quantity > 0).map((h) => h.isin));
        const shown = instruments.filter((i) => held.has(i.isin));
        const day = today();
        const latest = new Map<string, PriceItem>();
        const yearAgo = new Map<string, PriceItem>();
        await Promise.all(
          shown.filter((i) => i.type !== "BOND_RETAIL").map(async (i) => {
            const [now, then] = await Promise.all([repo.latestPrice(i.isin, i.venue, day), repo.latestPrice(i.isin, i.venue, addDays(day, -365))]);
            if (now) latest.set(i.isin, now);
            if (then) yearAgo.set(i.isin, then);
          }),
        );
        const rates = new Map((snap?.holdings ?? []).filter((h) => h.rate).map((h) => [h.isin, h.rate!] as const));
        return json(200, priceRows(shown, latest, yearAgo, day, 7, rates));
      }
      case "GET /holdings/history": {
        // One position's daily value and cost (`account` + `isin`), or an instrument's total across the accounts
        // that hold it now (`isin` only).
        const id = q["isin"];
        if (!id || !ISIN.test(id)) return json(400, { error: "Invalid ISIN" });
        const accounts = q["account"] ? [q["account"]] : [...new Set(((await repo.getSnapshot("LATEST"))?.holdings ?? []).filter((h) => h.isin === id).map((h) => h.account))];
        const byDate = new Map<string, { date: string; value: number; cost: number; quantity: number }>();
        for (const a of accounts)
          for (const d of await repo.queryPositionDays(a, id, from, to)) {
            const p = byDate.get(d.date) ?? { date: d.date, value: 0, cost: 0, quantity: 0 };
            p.value = Math.round((p.value + (d.value ?? 0)) * 100) / 100;
            p.cost = Math.round((p.cost + d.cost) * 100) / 100;
            p.quantity += d.quantity;
            byDate.set(d.date, p);
          }
        return json(200, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
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
