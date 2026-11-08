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
import { CatalystAssumptionsInput, catalystAssumptions, CatalystViewsInput, codePrefix, issuerKey, trackRecord, type AiSwitch, type CatalystAssumptions, type CatalystBondItem, type CatalystEntityItem, type CatalystViews, type TrackBond } from "@portfolio/core/catalyst/index";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ParsedFiling } from "@portfolio/core/catalyst/filings/filingParser";
import { FilingRefused, storeFiling } from "../filings.ts";
import { INDUSTRIES } from "@portfolio/core/catalyst/issuers/index";
import { analysisInputs, analysisOf } from "../analysis.ts";
import { hasAnyGroup } from "../../lib/access.ts";
import { jobRuns } from "../../lib/context.ts";
import { JOB_NAMES, jobTable } from "../../lib/jobs.ts";
import { catalystRepo, queueCatalyst } from "../context.ts";
import { ASSUMPTIONS_SETTING, offersOn, VIEWS_SETTING } from "../metrics.ts";

const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const sqs = new SQSClient({});
const s3 = new S3Client({});

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
    const [bonds, screen, terms, curve, links, entities] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listScreen(), catalystRepo.listTerms(), catalystRepo.latestCurve(), catalystRepo.listLinks(), catalystRepo.listEntities()]);
    const termsBy = new Map(terms.map((t) => [t.isin, t]));
    const entityBy = new Map(entities.map((e) => [e.entityId, e]));
    const companyOf = new Map(links.filter((l) => l.entityId && entityBy.has(l.entityId)).map((l) => [l.isin, entityBy.get(l.entityId!)!]));
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
          ...company(companyOf.get(b.isin)),
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
    const [events, track, link] = await Promise.all([catalystRepo.listEvents(isin), issuerTrack(bond, terms?.issuer), catalystRepo.getLink(isin)]);
    const entity = link?.entityId ? await catalystRepo.getEntity(link.entityId) : undefined;
    return json(200, {
      bond: strip(bond),
      terms: terms ? strip(terms) : null,
      coupons,
      market,
      sessions: sessions.filter((s) => s.market === market).map(({ PK: _p, SK: _s, isin: _i, market: _m, source: _src, fetchedAt: _f, ...s }) => s),
      quotes: quotes.filter((q) => q.market === market).map(({ PK: _p, SK: _s, isin: _i, market: _m, source: _src, fetchedAt: _f, ...q }) => q),
      events: events.map(({ PK: _p, SK: _s, isin: _i, source: _src, fetchedAt: _f, ...e }) => e),
      track,
      company: entity ? entityView(entity) : null,
    });
  },

  "GET /catalyst/entities": async () => {
    // The companies behind bonds, with their names and how many bonds each has (listed and in all).
    const [entities, names, links, bonds] = await Promise.all([catalystRepo.listEntities(), catalystRepo.listNames(), catalystRepo.listLinks(), catalystRepo.listBonds()]);
    const status = new Map(bonds.map((b) => [b.isin, b.status]));
    return json(200, {
      entities: entities.map((e) => {
        const own = links.filter((l) => l.entityId === e.entityId);
        return { ...entityView(e), names: names.filter((n) => n.entityId === e.entityId).map((n) => n.name), bonds: own.length, listed: own.filter((l) => status.get(l.isin) === "listed").length };
      }),
    });
  },

  "GET /catalyst/entities/{id}": async (event) => {
    const id = pathParam(event, "id");
    const entity = await catalystRepo.getEntity(id);
    if (!entity) return json(404, { error: `No company ${id}` });
    const [names, links, bonds] = await Promise.all([catalystRepo.listNames(), catalystRepo.listLinks(), catalystRepo.listBonds()]);
    const own = new Set(links.filter((l) => l.entityId === id).map((l) => l.isin));
    const theirs = bonds.filter((b) => own.has(b.isin));
    const [years, filings, inputs] = await Promise.all([catalystRepo.listYears(id), catalystRepo.listFilings(id), analysisInputs(today())]);
    return json(200, {
      company: entityView(entity),
      analysis: await analysisOf(entity, inputs, years),
      years: years.map(({ PK: _p, SK: _s, lines, ...y }) => ({ ...y, lines: lines.length })),
      filings: filings.map(({ PK: _p, SK: _s, ...f }) => f),
      names: names.filter((n) => n.entityId === id).map(stripKeys),
      bonds: theirs.map((b) => ({ isin: b.isin, code: b.code, status: b.status, maturity: b.maturity, segment: b.segment })),
      track: await trackOf(theirs, entity.legalName),
    });
  },

  "GET /catalyst/names": async () => json(200, { names: (await catalystRepo.listNames()).map(stripKeys) }),

  "PUT /catalyst/names/{name}": async (event) => {
    // Link a listed name to a company (or unlink it), or confirm the link the code made (review → confirmed).
    const name = pathParam(event, "name");
    const body = NameInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: "body: { entityId?: string | null }" });
    const before = await catalystRepo.getName(name);
    const entityId = body.data.entityId === undefined ? (before?.entityId ?? null) : body.data.entityId;
    if (entityId && !(await catalystRepo.getEntity(entityId))) return json(400, { error: `No company ${entityId}` });
    const by = userOf(event);
    const item = {
      ...(before ? stripKeys(before) : {}),
      name,
      entityId,
      status: entityId ? ("confirmed" as const) : ("unresolved" as const),
      evidence: entityId ? `${before?.evidence ? `${before.evidence}; ` : ""}confirmed by ${by}` : `unlinked by ${by}`,
      updatedAt: new Date().toISOString(),
    };
    await catalystRepo.putNames([item]);
    if (entityId && before?.aiAnalysis) await passSwitch(entityId, before.aiAnalysis);
    return json(200, item);
  },

  "PUT /catalyst/names/{name}/ai": async (event) => {
    // AI analysis for a listed name: on its company when it's linked, else kept on the name until it is.
    const name = pathParam(event, "name");
    const body = SwitchInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: "body: { on: boolean }" });
    const before = await catalystRepo.getName(name);
    if (!before) return json(404, { error: `No listed name ${name}` });
    const ai: AiSwitch = { on: body.data.on, by: userOf(event), at: new Date().toISOString() };
    if (before.entityId) return switchEntity(before.entityId, ai);
    await catalystRepo.putNames([{ ...stripKeys(before), aiAnalysis: ai, updatedAt: ai.at }]);
    return json(200, { name, aiAnalysis: ai });
  },

  "PUT /catalyst/entities/{id}": async (event) => {
    const id = pathParam(event, "id");
    const body = EntityInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const entity = await catalystRepo.getEntity(id);
    if (!entity) return json(404, { error: `No company ${id}` });
    // null clears a kind or an override.
    const { financeRuleSet, ruleSetOverride, ...set } = body.data;
    const next: Entity = { ...stripKeys(entity), ...set, ...(body.data.shortName ? { shortNameSet: true } : {}), updatedAt: new Date().toISOString() };
    if (financeRuleSet === null) delete next.financeRuleSet;
    else if (financeRuleSet) next.financeRuleSet = financeRuleSet;
    if (ruleSetOverride === null) delete next.ruleSetOverride;
    else if (ruleSetOverride) next.ruleSetOverride = ruleSetOverride;
    await queueCatalyst({ kind: "metrics" });
    await catalystRepo.putEntities([next]);
    return json(200, entityView(next));
  },

  "PUT /catalyst/entities/{id}/ai": async (event) => {
    const id = pathParam(event, "id");
    const body = SwitchInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: "body: { on: boolean }" });
    return switchEntity(id, { on: body.data.on, by: userOf(event), at: new Date().toISOString() });
  },

  "POST /catalyst/filings/upload-url": async () => {
    // Where the CLI puts a report before importing it (API Gateway takes at most 10 MB; ESEF packages run to 30).
    const key = `catalyst/uploads/${randomUUID()}`;
    const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: Resource.Files.name, Key: key }), { expiresIn: 900 });
    return json(200, { key, url });
  },

  "POST /catalyst/filings": async (event) => {
    // A report read on the user's machine: the parsed filing, checked again here and stored (../filings.ts).
    const body = FilingInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const b = body.data;
    try {
      const result = await storeFiling({
        entityId: b.entityId,
        filing: b.filing as unknown as ParsedFiling,
        sha256: b.sha256,
        extension: b.extension,
        contentType: CONTENT_TYPE[b.extension],
        fileName: b.fileName,
        original: { uploadKey: b.uploadKey },
        enteredBy: b.enteredBy ?? userOf(event),
        force: b.force ?? false,
        dryRun: b.dryRun ?? false,
      });
      const { rows, ...rest } = result;
      return json(200, { ...rest, years: rows.map((r) => ({ period: r.period, column: r.column, months: r.months, figures: Object.fromEntries(Object.entries(r.figures).map(([k, v]) => [k, v?.value])) })) });
    } catch (err) {
      if (err instanceof FilingRefused) return json(422, { error: err.message });
      throw err;
    }
  },

  "PUT /catalyst/entities/{id}/years/{period}": async (event) => {
    // Your review of a year: hand-checked (the figures match the printed report) or flagged (something's wrong).
    const id = pathParam(event, "id");
    const period = pathParam(event, "period");
    const body = ReviewInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: 'body: { status: "parsed" | "hand-checked" | "flagged", note?: string }' });
    const year = (await catalystRepo.listYears(id)).find((y) => y.period === period);
    if (!year) return json(404, { error: `No year ${period} of ${id}` });
    const { PK: _p, SK: _s, ...row } = year;
    const review = { status: body.data.status, ...(body.data.note ? { note: body.data.note } : {}), at: new Date().toISOString(), by: userOf(event) };
    await catalystRepo.putYears([{ ...row, review }]);
    return json(200, { period, review });
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

// --- companies and names (phase 2, N2) ------------------------------------------------------------------------

const CONTENT_TYPE: Record<"xml" | "zip" | "xhtml" | "pdf", string> = { xml: "application/xml", zip: "application/zip", xhtml: "application/xhtml+xml", pdf: "application/pdf" };
const FilingInput = z
  .object({
    entityId: z.string().min(1).max(40),
    uploadKey: z.string().regex(/^catalyst\/uploads\/[0-9a-f-]{36}$/),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    extension: z.enum(["xml", "zip", "xhtml", "pdf"]),
    fileName: z.string().max(200),
    filing: z.object({ format: z.enum(["krs-xml", "esef", "ifrs-text", "ai-pdf"]), scope: z.enum(["single", "group"]), periods: z.array(z.object({ periodEnd: z.string(), lines: z.array(z.unknown()) }).passthrough()).min(1), checks: z.array(z.string()) }).passthrough(),
    enteredBy: z.string().max(100).optional(),
    force: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();
const ReviewInput = z.object({ status: z.enum(["parsed", "hand-checked", "flagged"]), note: z.string().max(500).optional() }).strict();
const NameInput = z.object({ entityId: z.string().min(1).max(40).nullable().optional() }).strict();
const SwitchInput = z.object({ on: z.boolean() }).strict();
const RULE_SETS = ["general", "developer", "contractor", "consumer", "collector", "leasing", "investment"] as const;
const EntityInput = z
  .object({
    shortName: z.string().trim().min(1).max(60),
    industry: z.enum(INDUSTRIES),
    financeRuleSet: z.enum(["collector", "leasing", "investment"]).nullable(),
    ruleSetOverride: z.object({ ruleSet: z.enum(RULE_SETS), reason: z.string().trim().min(1).max(300) }).strict().nullable(),
  })
  .partial()
  .strict();

function parseBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  try {
    return JSON.parse(event.body ?? "{}");
  } catch {
    return undefined;
  }
}

/** Who made a change: the e-mail in the login token, else its user name. */
function userOf(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  return String(claims["email"] ?? claims["username"] ?? claims["cognito:username"] ?? claims["sub"] ?? "unknown");
}

/** A path parameter, decoded (names carry spaces and Polish letters). */
function pathParam(event: APIGatewayProxyEventV2WithJWTAuthorizer, key: string): string {
  const raw = event.pathParameters?.[key] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const stripKeys = <T extends { PK: string; SK: string; GSI1PK: string; GSI1SK: string }>({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, ...rest }: T) => rest;

type Entity = Omit<CatalystEntityItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;

/** The company as the views show it (AI analysis off unless switched on). */
function entityView(e: Entity) {
  return {
    entityId: e.entityId,
    shortName: e.shortName,
    legalName: e.legalName,
    country: e.country,
    krs: e.krs,
    lei: e.lei,
    leiStatus: e.leiStatus,
    status: e.status,
    legalForm: e.legalForm,
    pkd: e.pkd ?? null,
    register: e.register ?? null,
    industry: e.industry ?? null,
    financeRuleSet: e.financeRuleSet ?? null,
    ruleSetOverride: e.ruleSetOverride ?? null,
    aiAnalysis: e.aiAnalysis ?? { on: false },
  };
}

/** A bond row's company fields. */
function company(e: Entity | undefined) {
  return e ? { entityId: e.entityId, issuerShort: e.shortName, issuerLegal: e.legalName, aiAnalysis: e.aiAnalysis?.on ?? false } : {};
}

async function switchEntity(entityId: string, ai: AiSwitch) {
  const entity = await catalystRepo.getEntity(entityId);
  if (!entity) return json(404, { error: `No company ${entityId}` });
  await catalystRepo.putEntities([{ ...stripKeys(entity), aiAnalysis: ai, updatedAt: ai.at }]);
  return json(200, { entityId, aiAnalysis: ai });
}

/** A switch set on a name before it was linked passes to its company, unless the company has one already. */
async function passSwitch(entityId: string, ai: AiSwitch) {
  const entity = await catalystRepo.getEntity(entityId);
  if (!entity || entity.aiAnalysis) return;
  await catalystRepo.putEntities([{ ...stripKeys(entity), aiAnalysis: ai, updatedAt: new Date().toISOString() }]);
}

/** The track record of a set of bonds (core/catalyst/trackRecord.ts), each with its GPW measures and last close. */
async function trackOf(group: CatalystBondItem[], issuer: string | undefined) {
  const exitsNow = await catalystRepo.getExitsNow();
  const bonds: TrackBond[] = await Promise.all(
    group.map(async (b) => {
      const [events, last] = await Promise.all([catalystRepo.listEvents(b.isin), b.status === "ended" ? catalystRepo.lastSession(b.isin) : Promise.resolve(undefined)]);
      return {
        isin: b.isin,
        code: b.code,
        maturity: b.maturity,
        status: b.status,
        firstSeen: b.firstSeen,
        lastSeen: b.lastSeen,
        lastClose: last?.close ?? null,
        events: events.map((e) => ({ published: e.published, action: e.action, reason: e.reason, signal: e.signal })),
      };
    }),
  );
  const markings = issuer ? (exitsNow?.marked ?? []).filter((m) => issuerKey(m.issuer) === issuerKey(issuer)).map((m) => m.marking) : [];
  return trackRecord(bonds, today(), markings);
}

/**
 * The repayment track record of a bond's issuer: its company's bonds once the bond is linked, else the bonds sharing
 * its code's prefix ("KRU0228", "KRU0829").
 */
async function issuerTrack(bond: CatalystBondItem, issuer: string | undefined) {
  const link = await catalystRepo.getLink(bond.isin);
  if (link?.entityId) {
    const [links, bonds, entity] = await Promise.all([catalystRepo.listLinks(), catalystRepo.listBonds(), catalystRepo.getEntity(link.entityId)]);
    const own = new Set(links.filter((l) => l.entityId === link.entityId).map((l) => l.isin));
    return { prefix: null, company: entity?.shortName ?? link.entityId, ...(await trackOf(bonds.filter((b) => own.has(b.isin)), issuer ?? entity?.legalName)) };
  }
  const prefix = codePrefix(bond.code);
  const group = (await catalystRepo.listBondsByPrefix(prefix)).filter((b) => codePrefix(b.code) === prefix);
  return { prefix, company: null, ...(await trackOf(group, issuer)) };
}
