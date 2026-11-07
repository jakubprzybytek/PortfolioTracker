// The Catalyst module's API (/api/catalyst/*, infra/catalyst.ts): the same login and groups as PT's API.
//   GET  /catalyst/status                 what the module holds, its jobs' latest runs, failed requests
//   GET  /catalyst/bonds                  the screen: every listed bond's row with its terms, and the State's curves
//   GET  /catalyst/bonds/{isin}?from=     one bond: terms, interest periods, sessions and quotes of its main market
//   GET  /catalyst/settings/assumptions   the assumptions in use, the saved ones, the defaults, the retail offers
//   PUT  /catalyst/settings/assumptions   save them ({ reset: true }: back to the defaults); the metrics are recomputed
//   GET  /catalyst/views, PUT /catalyst/views   the saved views of the screen (name + URL parameters)

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { addDays, today } from "@portfolio/core";
import { CatalystAssumptionsInput, catalystAssumptions, CatalystViewsInput, type CatalystAssumptions, type CatalystViews } from "@portfolio/core/catalyst/index";
import { hasAnyGroup } from "../../lib/access.ts";
import { jobRuns } from "../../lib/context.ts";
import { JOB_NAMES, jobTable } from "../../lib/jobs.ts";
import { catalystRepo, queueCatalyst } from "../context.ts";
import { ASSUMPTIONS_SETTING, offersOn, VIEWS_SETTING } from "../metrics.ts";

const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const sqs = new SQSClient({});

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({ statusCode: status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Requests that failed 3 times and wait in the dead-letter queue (null when it can't be read). */
async function deadLetterCount(): Promise<number | null> {
  try {
    const res = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: Resource.CatalystDeadLetter.url, AttributeNames: ["ApproximateNumberOfMessages"] }));
    return Number(res.Attributes?.["ApproximateNumberOfMessages"] ?? 0);
  } catch (err) {
    console.error(JSON.stringify({ event: "dead-letter count failed", error: String(err) }));
    return null;
  }
}

async function assumptionsNow() {
  const date = (await catalystRepo.latestDay())?.date ?? today();
  const [saved, offers] = await Promise.all([catalystRepo.getSetting<Partial<CatalystAssumptions>>(ASSUMPTIONS_SETTING), offersOn(date)]);
  const { defaults, assumptions } = catalystAssumptions(saved, offers);
  return {
    assumptions,
    defaults,
    saved: saved ?? null,
    offers: offers.map((o) => ({ series: o.series, kind: o.kind, termMonths: o.termMonths, firstRate: o.rates[0] ?? null, margin: o.margin ?? null })),
  };
}

type Handler = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<APIGatewayProxyResultV2>;

const ROUTES: Record<string, Handler> = {
  "GET /catalyst/status": async () => {
    // How many bonds the module holds, the latest run of each of its jobs, and failed requests.
    const jobs = JOB_NAMES.filter((j) => jobTable(j) === "catalyst");
    const [bonds, runs, deadLetter] = await Promise.all([catalystRepo.countBonds(), Promise.all(jobs.map(async (j) => [j, (await jobRuns(j).latest(j)) ?? null] as const)), deadLetterCount()]);
    return json(200, { bonds, jobs: Object.fromEntries(runs), deadLetter });
  },

  "GET /catalyst/bonds": async () => {
    // Listed bonds with a screen row, their terms in short, and the curves the premiums were measured against.
    const [bonds, screen, terms, curve] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listScreen(), catalystRepo.listTerms(), catalystRepo.latestCurve()]);
    const termsBy = new Map(terms.map((t) => [t.isin, t]));
    const screenBy = new Map(screen.map((s) => [s.isin, s]));
    const rows = bonds
      .filter((b) => b.status === "listed" && screenBy.has(b.isin))
      .map((b) => {
        const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, computedAt: _c, isin: _i, code: _code, maturity: _m, nominal: _n, ...row } = screenBy.get(b.isin)!;
        const t = termsBy.get(b.isin);
        return {
          isin: b.isin,
          code: b.code,
          segment: b.segment,
          currency: b.currency,
          markets: b.markets,
          maturity: b.maturity,
          nominal: b.nominal,
          ...(t && !t.notFound
            ? { issuer: t.issuer ?? null, coupon: t.coupon, couponText: t.couponText ?? null, secured: t.secured ?? null, issueAmount: t.issueValue ? (t.issueValue.amount * (b.nominal ?? t.issueValue.nominal)) / t.issueValue.nominal : null }
            : {}),
          ...row,
        };
      });
    const computedAt = screen.map((s) => s.computedAt).sort().at(-1) ?? null;
    return json(200, { date: curve?.date ?? null, computedAt, curve: curve ? { fixed: curve.fixed, wz: curve.wz } : null, rows });
  },

  "GET /catalyst/bonds/{isin}": async (event) => {
    const isin = event.pathParameters?.["isin"] ?? "";
    if (!ISIN.test(isin)) return json(400, { error: "Invalid ISIN" });
    const bond = await catalystRepo.getBond(isin);
    if (!bond) return json(404, { error: `No bond ${isin}` });
    const to = (await catalystRepo.latestDay())?.date ?? today();
    const fromParam = event.queryStringParameters?.["from"];
    if (fromParam !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) return json(400, { error: "from: YYYY-MM-DD" });
    const from = fromParam ?? addDays(to, -365);
    const market = bond.markets.find((m) => m.startsWith("GPW")) ?? bond.markets[0] ?? "";
    const [terms, coupons, sessions, quotes] = await Promise.all([catalystRepo.listTerms().then((all) => all.find((t) => t.isin === isin) ?? null), catalystRepo.listCoupons(isin), catalystRepo.listSessions(isin, from, to), catalystRepo.listQuotes(isin, from, to)]);
    const strip = <T extends { PK: string; SK: string }>({ PK: _p, SK: _s, ...rest }: T) => rest;
    return json(200, {
      bond: strip(bond),
      terms: terms ? strip(terms) : null,
      coupons,
      market,
      sessions: sessions.filter((s) => s.market === market).map(({ PK: _p, SK: _s, isin: _i, market: _m, source: _src, fetchedAt: _f, ...s }) => s),
      quotes: quotes.filter((q) => q.market === market).map(({ PK: _p, SK: _s, isin: _i, market: _m, source: _src, fetchedAt: _f, ...q }) => q),
    });
  },

  "GET /catalyst/settings/assumptions": async () => json(200, await assumptionsNow()),

  "PUT /catalyst/settings/assumptions": async (event) => {
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return json(400, { error: "body: not JSON" });
    }
    if ((body as { reset?: unknown }).reset === true) {
      await catalystRepo.putSetting(ASSUMPTIONS_SETTING, null);
    } else {
      const parsed = CatalystAssumptionsInput.safeParse(body);
      if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
      if (parsed.data.alternative === "rate" && parsed.data.altRate === undefined) return json(400, { error: "altRate: needed with the alternative 'rate'" });
      await catalystRepo.putSetting(ASSUMPTIONS_SETTING, parsed.data);
    }
    await queueCatalyst({ kind: "metrics" });
    return json(200, await assumptionsNow());
  },

  "GET /catalyst/views": async () => json(200, { views: (await catalystRepo.getSetting<CatalystViews>(VIEWS_SETTING)) ?? [] }),

  "PUT /catalyst/views": async (event) => {
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? "{}");
    } catch {
      return json(400, { error: "body: not JSON" });
    }
    const parsed = CatalystViewsInput.safeParse((body as { views?: unknown }).views);
    if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `views.${i.path.join(".")}: ${i.message}`).join("; ") });
    await catalystRepo.putSetting(VIEWS_SETTING, parsed.data);
    return json(200, { views: parsed.data });
  },
};

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  if (!hasAnyGroup(event.requestContext.authorizer?.jwt?.claims, ACCESS_GROUPS)) return json(403, { error: "This account has no access" });
  const handle = ROUTES[event.routeKey];
  if (!handle) return json(404, { error: `No route ${event.routeKey}` });
  try {
    return await handle(event);
  } catch (err) {
    const requestId = event.requestContext.requestId;
    console.error(`${event.routeKey} failed (request ${requestId}):`, err);
    return json(500, { error: `Something went wrong on the server (request ${requestId})` });
  }
}
