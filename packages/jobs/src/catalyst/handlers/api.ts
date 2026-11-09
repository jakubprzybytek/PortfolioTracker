// The Catalyst module's API (/api/catalyst/*, infra/catalyst.ts): the same login and groups as PT's API.
//   GET  /catalyst/status                 what the module holds, its jobs' latest runs, failed requests
//   GET  /catalyst/bonds                  the screen: every listed bond's row with its terms, and the State's curves
//   GET  /catalyst/bonds/{isin}?from=     one bond: terms, interest periods, sessions and quotes of its main market
//   GET  /catalyst/settings/assumptions   the assumptions in use, the saved ones, the defaults, the retail offers
//   PUT  /catalyst/settings/assumptions   save them ({ reset: true }: back to the defaults); the metrics are recomputed
//   GET  /catalyst/views, PUT /catalyst/views   the saved views of the screen (name + URL parameters)
//   GET  /catalyst/entities[/{id}]        the companies (with their latest judgement's date); one company: scorecard,
//                                         years, filings, judgements, collected figures, track record
//   GET  /catalyst/entities/{id}/years/{period}   a year's statement lines as printed
//   GET  /catalyst/entities/{id}/filings/{sha}    a link to a report's original (15 minutes)
//   GET  /catalyst/work                   what needs doing for the companies with AI analysis on (`catalyst work`)
//   POST /catalyst/entities/{id}/analyses|figures|known   a judgement, collected figures, hand-read figures
//   GET  /catalyst/checklist, PUT /catalyst/checklist/{id}/{year}/{scope}   reports to download by hand
//   POST /catalyst/entities/{id}/documents, GET …/documents/{sha}   a company's other documents, and a link to one
//   GET|POST|DELETE /catalyst/agent-token  the agent's token (yours only: shown once, only its SHA-256 kept)
//   ANY  /catalyst/agent/{proxy+}         the agent's way in (bearer token): the reads and the writes it may make
//                                         (core/catalyst/agent.ts, AGENT_WRITES), as the routes above

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { addDays, today } from "@portfolio/core";
import { DocumentInput } from "@portfolio/core/catalyst/index";
import { storeDocument } from "../documents.ts";
import { AgentEntityInput, AnalysisInput, ChecklistInput, CollectedFiguresInput, KnownInput, NameLinkInput, agentMayCall, entityIdOf, latestPeriod, KRS_REGISTER, krsExtract, leiRecords, sameName, shortName, workItems, type Fetcher } from "@portfolio/core/catalyst/index";
import { CatalystAssumptionsInput, catalystAssumptions, CatalystViewsInput, codePrefix, issuerKey, trackRecord, type AiSwitch, type CatalystAssumptions, type CatalystBondItem, type CatalystEntityItem, type CatalystViews, type TrackBond } from "@portfolio/core/catalyst/index";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ParsedFiling } from "@portfolio/core/catalyst/filings/filingParser";
import { FilingRefused, storeFiling } from "../filings.ts";
import { financeRuleSetFor, INDUSTRIES, isInFundamentalScope } from "@portfolio/core/catalyst/issuers/index";
import { newFeedToken, shouldTouch, tokenMatches, type FeedToken } from "../../lib/feedToken.ts";
import { fetchSource } from "../../lib/http.ts";
import { analysisInputs, analysisOf } from "../analysis.ts";
import { hasAnyGroup } from "../../lib/access.ts";
import { jobRuns } from "../../lib/context.ts";
import { JOB_NAMES, jobTable } from "../../lib/jobs.ts";
import { catalystRepo, queueCatalyst } from "../context.ts";
import { ASSUMPTIONS_SETTING, offersOn, VIEWS_SETTING } from "../metrics.ts";

const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");
/** Where the agent token's hash is kept (the module's settings). */
const AGENT_TOKEN_SETTING = "agentToken";
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
        // The company's signals go out as `scorecard`: under `issuer` they'd hide the listed name.
        const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, computedAt: _c, isin: _i, code: _code, maturity: _m, nominal: _n, issuer: signals, ...row } = screenBy.get(b.isin)!;
        const t = termsBy.get(b.isin);
        return {
          isin: b.isin,
          code: b.code,
          segment: b.segment,
          currency: b.currency,
          markets: b.markets,
          maturity: b.maturity,
          nominal: b.nominal,
          ...company(companyOf.get(b.isin), entityBy),
          ...(t && !t.notFound
            ? { issuer: t.issuer ?? null, coupon: t.coupon, couponText: t.couponText ?? null, secured: t.secured ?? null, issueAmount: t.issueValue ? (t.issueValue.amount * (b.nominal ?? t.issueValue.nominal)) / t.issueValue.nominal : null }
            : {}),
          ...row,
          ...(signals ? { scorecard: signals } : {}),
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
    // The latest judgement's date: only companies whose AI analysis was ever on have judgements.
    const judged = new Map(await Promise.all(entities.filter((e) => e.aiAnalysis).map(async (e) => [e.entityId, (await catalystRepo.listAnalyses(e.entityId)).map((a) => a.at).sort().at(-1) ?? null] as const)));
    return json(200, {
      entities: entities.map((e) => {
        const own = links.filter((l) => l.entityId === e.entityId);
        return { ...entityView(e), names: names.filter((n) => n.entityId === e.entityId).map((n) => n.name), bonds: own.length, listed: own.filter((l) => status.get(l.isin) === "listed").length, judgedAt: judged.get(e.entityId) ?? null };
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
    const [years, filings, inputs, analyses, collected, documents] = await Promise.all([catalystRepo.listYears(id), catalystRepo.listFilings(id), analysisInputs(today()), catalystRepo.listAnalyses(id), catalystRepo.listCollectedFigures(id), catalystRepo.listDocuments(id)]);
    return json(200, {
      company: entityView(entity),
      analysis: await analysisOf(entity, inputs, years),
      years: years.map(({ PK: _p, SK: _s, lines, ...y }) => ({ ...y, lines: lines.length })),
      filings: filings.map(({ PK: _p, SK: _s, ...f }) => f),
      // Newest first.
      analyses: analyses.map(({ PK: _p, SK: _s, ...a }) => a).sort((a, b) => b.at.localeCompare(a.at)),
      collected: collected.map(({ PK: _p, SK: _s, ...c }) => c).sort((a, b) => b.at.localeCompare(a.at)),
      documents: documents.map(({ PK: _p, SK: _s, key: _k, ...d }) => d).sort((a, b) => b.date.localeCompare(a.date)),
      names: names.filter((n) => n.entityId === id).map(stripKeys),
      bonds: theirs.map((b) => ({ isin: b.isin, code: b.code, status: b.status, maturity: b.maturity, segment: b.segment })),
      track: await trackOf(theirs, entity.legalName),
    });
  },

  "GET /catalyst/names": async () => json(200, { names: (await catalystRepo.listNames()).map(stripKeys) }),

  "PUT /catalyst/names/{name}": async (event) => {
    // Link a listed name to a company (or unlink it), or confirm the link the code made (review → confirmed).
    const name = pathParam(event, "name");
    // The agent's link (with its evidence) is `resolved` when the names agree, else `review` until you confirm it; it
    // can make the company from its LEI (GLEIF and the KRS register, as the identity job does).
    const body = NameLinkInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const agent = isAgent(event);
    if (agent && !body.data.evidence) return json(400, { error: "evidence: the agent says why" });
    const before = await catalystRepo.getName(name);
    let entityId = body.data.entityId === undefined ? (before?.entityId ?? null) : body.data.entityId;
    let entity: Entity | undefined = entityId ? await catalystRepo.getEntity(entityId) : undefined;
    if (!entity && body.data.lei) {
      entity = await entityFromLei(body.data.lei);
      if (!entity) return json(400, { error: `GLEIF has no LEI ${body.data.lei}` });
      if (entityId && entityId !== entity.entityId) return json(400, { error: `LEI ${body.data.lei} is company ${entity.entityId}, not ${entityId}` });
      entityId = entity.entityId;
    }
    if (entityId && !entity) return json(400, { error: `No company ${entityId} (give its lei to make it)` });
    const by = userOf(event);
    const status = !entityId ? ("unresolved" as const) : !agent ? ("confirmed" as const) : sameName(name, entity!.legalName) ? ("resolved" as const) : ("review" as const);
    const item = {
      ...(before ? stripKeys(before) : {}),
      name,
      entityId,
      status,
      evidence: body.data.evidence ? `${body.data.evidence} (${by})` : entityId ? `${before?.evidence ? `${before.evidence}; ` : ""}confirmed by ${by}` : `unlinked by ${by}`,
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
    const raw = parseBody(event);
    // The agent describes a company; its lender kind and override are yours.
    const body = (isAgent(event) ? AgentEntityInput : EntityInput).safeParse(raw);
    if (!body.success) {
      const refused = isAgent(event) && raw && typeof raw === "object" && ("financeRuleSet" in raw || "ruleSetOverride" in raw || "aiAnalysis" in raw);
      return json(refused ? 403 : 400, { error: refused ? "A lender's kind, an override and the AI analysis switch are set in the app" : `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    }
    const entity = await catalystRepo.getEntity(id);
    if (!entity) return json(404, { error: `No company ${id}` });
    // null clears a kind or an override.
    const { financeRuleSet, ruleSetOverride, financialsEntityId, ...set } = body.data as z.infer<typeof EntityInput>;
    if (financialsEntityId && !(await catalystRepo.getEntity(financialsEntityId))) return json(400, { error: `No company ${financialsEntityId}` });
    const next: Entity = { ...stripKeys(entity), ...set, ...(body.data.shortName ? { shortNameSet: true } : {}), updatedAt: new Date().toISOString() };
    if (financeRuleSet === null) delete next.financeRuleSet;
    else if (financeRuleSet) next.financeRuleSet = financeRuleSet;
    if (ruleSetOverride === null) delete next.ruleSetOverride;
    else if (ruleSetOverride) next.ruleSetOverride = ruleSetOverride;
    if (financialsEntityId === null) delete next.financialsEntityId;
    else if (financialsEntityId) next.financialsEntityId = financialsEntityId;
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
        // The agent's imports are recorded as the agent's, whatever it sends.
        enteredBy: isAgent(event) ? userOf(event) : (b.enteredBy ?? userOf(event)),
        force: b.force ?? false,
        dryRun: b.dryRun ?? false,
      });
      const { rows, ...rest } = result;
      // A dry run also shows the scorecard the company would get with these years.
      let preview: unknown;
      const entity = result.dryRun ? await catalystRepo.getEntity(b.entityId) : undefined;
      if (entity) {
        const stored = (await catalystRepo.listYears(b.entityId)).filter((y) => !result.stored.includes(y.period));
        const a = await analysisOf({ ...entity, financialsEntityId: undefined }, await analysisInputs(today()), [...stored, ...rows]);
        preview = { state: a.state, ruleSet: a.ruleSet, confidence: a.scorecard?.confidence?.level ?? null, dimensions: a.scorecard?.dimensions.map((d) => ({ name: d.name, signal: d.signal, ...(d.trend ? { arrow: d.trend.arrow } : {}), metrics: d.metrics.filter((m) => m.scored !== false).map((m) => `${m.name} ${m.formattedValue}`) })) ?? [] };
      }
      return json(200, { ...rest, years: rows.map((r) => ({ period: r.period, column: r.column, months: r.months, figures: Object.fromEntries(Object.entries(r.figures).map(([k, v]) => [k, v?.value])) })), ...(preview ? { scorecard: preview } : {}) });
    } catch (err) {
      if (err instanceof FilingRefused) return json(422, { error: err.message });
      throw err;
    }
  },

  "GET /catalyst/entities/{id}/years/{period}": async (event) => {
    // A year's statement lines as printed (the Financials tab's full statements, the lines behind a figure).
    const id = pathParam(event, "id");
    const period = pathParam(event, "period");
    const year = (await catalystRepo.listYears(id)).find((y) => y.period === period);
    if (!year) return json(404, { error: `No year ${period} of ${id}` });
    return json(200, { period, currency: year.currency, presentedUnit: year.presentedUnit, lines: year.lines, figures: year.figures });
  },

  "GET /catalyst/entities/{id}/filings/{sha}": async (event) => {
    // A link to a report's original, valid 15 minutes.
    const id = pathParam(event, "id");
    const sha = pathParam(event, "sha");
    const filing = (await catalystRepo.listFilings(id)).find((f) => f.sha256 === sha);
    if (!filing) return json(404, { error: `No filing ${sha} of ${id}` });
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: Resource.Files.name, Key: filing.key, ResponseContentDisposition: `inline; filename="${filing.fileName.replace(/["\\]/g, "")}"` }), { expiresIn: 900 });
    return json(200, { url, fileName: filing.fileName });
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

  "GET /catalyst/work": async () => json(200, { items: await work() }),

  "POST /catalyst/entities/{id}/analyses": async (event) => {
    // A judgement, append-only (the latest is shown); a dry run returns it without storing.
    const id = pathParam(event, "id");
    const body = AnalysisInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const entity = await catalystRepo.getEntity(id);
    if (!entity) return json(404, { error: `No company ${id}` });
    const { markdown, meta, dryRun } = body.data;
    // What it rests on: the latest full year stored now (a later one makes it stale in `catalyst work`).
    const basedOn = latestPeriod(await catalystRepo.listYears(entity.financialsEntityId ?? id));
    const item = { entityId: id, at: new Date().toISOString(), ...(basedOn ? { basedOn } : {}), markdown, by: isAgent(event) ? meta.model : userOf(event), source: isAgent(event) ? ("agent" as const) : ("you" as const), sources: meta.sources, redFlags: meta.redFlags, ...(meta.scorecard !== undefined ? { scorecard: meta.scorecard } : {}) };
    if (!dryRun) await catalystRepo.putAnalyses([item]);
    return json(dryRun ? 200 : 201, { ...item, stored: !dryRun });
  },

  "POST /catalyst/entities/{id}/figures": async (event) => {
    // Figures collected from the web when there's no report (operating companies only, §9).
    const id = pathParam(event, "id");
    const body = CollectedFiguresInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const entity = await catalystRepo.getEntity(id);
    if (!entity) return json(404, { error: `No company ${id}` });
    if (entity.industry === "Finance" || entity.industry === "Municipal") return json(422, { error: "Collected figures are for operating companies only (§9)" });
    const { dryRun, ...data } = body.data;
    const item = { entityId: id, at: new Date().toISOString(), ...data, by: userOf(event), source: "agent" as const };
    if (!dryRun) await catalystRepo.putCollectedFigures([item]);
    return json(dryRun ? 200 : 201, { ...item, stored: !dryRun });
  },

  "POST /catalyst/entities/{id}/known": async (event) => {
    // Figures read by hand from a printed report, which `filings check` compares the stored years with.
    const id = pathParam(event, "id");
    const body = KnownInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    if (!(await catalystRepo.getEntity(id))) return json(404, { error: `No company ${id}` });
    const item = { entityId: id, ...body.data, source: `${body.data.source} (${userOf(event)})` };
    await catalystRepo.putKnown([item]);
    return json(201, item);
  },

  "POST /catalyst/entities/{id}/documents": async (event) => {
    // A document a judgement rests on, uploaded first (filings/upload-url); one already held isn't stored again.
    const id = pathParam(event, "id");
    const body = DocumentInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const { dryRun, sourceUrl, ...b } = body.data;
    try {
      const r = await storeDocument({ entityId: id, ...b, ...(sourceUrl ? { sourceUrl } : {}), by: userOf(event), dryRun: dryRun ?? false });
      const { key: _k, ...document } = r.document;
      return json(r.stored ? 201 : 200, { ...document, stored: r.stored, duplicate: r.duplicate });
    } catch (err) {
      if (err instanceof FilingRefused) return json(err.message.startsWith("No company") ? 404 : 422, { error: err.message });
      throw err;
    }
  },

  "GET /catalyst/entities/{id}/documents/{sha}": async (event) => {
    const id = pathParam(event, "id");
    const sha = pathParam(event, "sha");
    const doc = (await catalystRepo.listDocuments(id)).find((d) => d.sha256 === sha);
    if (!doc) return json(404, { error: `No document ${sha} of ${id}` });
    const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: Resource.Files.name, Key: doc.key, ResponseContentDisposition: `inline; filename="${doc.fileName.replace(/["\\]/g, "")}"` }), { expiresIn: 900 });
    return json(200, { url, fileName: doc.fileName });
  },

  "GET /catalyst/checklist": async () => json(200, { checklist: (await catalystRepo.listChecklist()).map(stripKeys).sort((a, b) => a.status.localeCompare(b.status) || a.entityId.localeCompare(b.entityId) || b.year - a.year) }),

  "PUT /catalyst/checklist/{id}/{year}/{scope}": async (event) => {
    // A report to download by hand from the KRS repository (the agent adds it), or its new state (you, as you go).
    const id = pathParam(event, "id");
    const year = Number(pathParam(event, "year"));
    const scope = pathParam(event, "scope");
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return json(400, { error: "year: four digits" });
    if (scope !== "group" && scope !== "single" && scope !== "any") return json(400, { error: "scope: group, single or any" });
    const body = ChecklistInput.safeParse(parseBody(event));
    if (!body.success) return json(400, { error: `body: ${body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const entity = await catalystRepo.getEntity(id);
    if (!entity) return json(404, { error: `No company ${id}` });
    const before = (await catalystRepo.listChecklist()).find((c) => c.entityId === id && c.year === year && c.scope === scope);
    const where = body.data.where ?? before?.where ?? (entity.krs ? `KRS repository, KRS ${entity.krs}` : undefined);
    if (!where) return json(400, { error: "where: where the report can be found" });
    const item = { entityId: id, krs: entity.krs, year, scope: scope as "group" | "single" | "any", where, status: body.data.status ?? before?.status ?? ("missing" as const), ...(body.data.note ? { note: body.data.note } : before?.note ? { note: before.note } : {}), by: userOf(event), at: new Date().toISOString() };
    await catalystRepo.putChecklist([item]);
    return json(200, item);
  },

  "GET /catalyst/agent-token": async () => {
    const t = await catalystRepo.getSetting<FeedToken | null>(AGENT_TOKEN_SETTING);
    return json(200, { token: t ? { createdAt: t.createdAt, lastUsedAt: t.lastUsedAt ?? null } : null });
  },

  "POST /catalyst/agent-token": async () => {
    // A new token, replacing any before it (that one stops working at once); returned only here.
    const { token, stored } = newFeedToken();
    await catalystRepo.putSetting(AGENT_TOKEN_SETTING, stored);
    return json(201, { token, createdAt: stored.createdAt });
  },

  "DELETE /catalyst/agent-token": async () => {
    await catalystRepo.putSetting(AGENT_TOKEN_SETTING, null);
    return json(200, { token: null });
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
  if (event.routeKey === AGENT_ROUTE) return agentHandler(event);
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

// --- the agent's way in (phase 2, N7) ------------------------------------------------------------------------

const AGENT_ROUTE = "ANY /catalyst/agent/{proxy+}";
/** The Catalyst routes as patterns: "GET /catalyst/entities/{id}" matches "GET /catalyst/entities/0000533217". */
const PATTERNS = Object.keys(ROUTES).map((key) => {
  const [method, path] = key.split(" ") as [string, string];
  const names: string[] = [];
  const re = new RegExp(
    `^${path.replace(/\{(\w+)\}/g, (_m, n: string) => {
      names.push(n);
      return "([^/]+)";
    })}$`,
  );
  return { key, method, re, names };
});

/**
 * `/catalyst/agent/<route>` with `Authorization: Bearer <agent token>`: the token's hash against the stored one, then
 * the route if the agent may call it (core/catalyst/agent.ts), as `agent (<x-catalyst-by>)`.
 */
async function agentHandler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const auth = event.headers["authorization"] ?? event.headers["Authorization"] ?? "";
  const token = /^Bearer (\S+)$/.exec(auth)?.[1];
  const stored = (await catalystRepo.getSetting<FeedToken | null>(AGENT_TOKEN_SETTING)) ?? undefined;
  if (!tokenMatches(token, stored)) return json(401, { error: "No agent token, or not the current one (make one in the Catalyst settings)" });
  if (shouldTouch(stored!)) await catalystRepo.putSetting(AGENT_TOKEN_SETTING, { ...stored, lastUsedAt: new Date().toISOString() });
  const rest = event.rawPath.split("/catalyst/agent/")[1] ?? "";
  const path = `/catalyst/${rest}`;
  const method = event.requestContext.http.method;
  const match = PATTERNS.filter((p) => p.method === method).map((p) => ({ p, m: p.re.exec(path) })).find((x) => x.m);
  if (!match) return json(404, { error: `No route ${method} ${path}` });
  if (!agentMayCall(match.p.key)) return json(403, { error: `The agent token can't call ${match.p.key}` });
  const by = (event.headers["x-catalyst-by"] ?? "").replace(/[^\w .:/()-]/g, "").slice(0, 80) || "unnamed";
  const routed: APIGatewayProxyEventV2WithJWTAuthorizer = {
    ...event,
    routeKey: match.p.key,
    pathParameters: Object.fromEntries(match.p.names.map((n, i) => [n, match.m![i + 1]!])),
    requestContext: { ...event.requestContext, authorizer: { principalId: "agent", integrationLatency: 0, jwt: { claims: { email: `agent (${by})`, agent: "true" }, scopes: [] } } },
  };
  try {
    return await ROUTES[match.p.key]!(routed);
  } catch (err) {
    const requestId = event.requestContext.requestId;
    console.error(`agent ${match.p.key} failed (request ${requestId}):`, err);
    return json(500, { error: `Something went wrong on the server (request ${requestId})` });
  }
}

/** A request made through the agent token. */
const isAgent = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => event.requestContext.authorizer?.jwt?.claims?.["agent"] === "true";

const gleifFetch: Fetcher = (url) => fetchSource(url, { minIntervalMs: 1100 });

/** A company from its LEI (GLEIF's record and, for a Polish one, the KRS extract), made if it isn't known. */
async function entityFromLei(lei: string): Promise<Entity | undefined> {
  const record = (await leiRecords(gleifFetch, [lei])).get(lei);
  if (!record) return undefined;
  const id = entityIdOf(record);
  const known = await catalystRepo.getEntity(id);
  if (known) return stripKeys(known);
  const krs = record.registeredAt === KRS_REGISTER && id === record.registeredAs ? id : null;
  const extract = krs ? await krsExtract(gleifFetch, krs).catch(() => undefined) : undefined;
  const now = new Date().toISOString();
  const entity: Entity = {
    entityId: id,
    shortName: shortName(record.legalName),
    legalName: record.legalName,
    country: record.country,
    krs,
    lei: record.lei,
    leiStatus: record.leiStatus,
    status: record.status,
    legalForm: extract?.legalForm ?? record.legalForm,
    ...(extract ? { pkd: extract.pkd, register: extract.register } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await catalystRepo.putEntities([entity]);
  return entity;
}

/** What needs doing (core/catalyst/agent.ts): the companies with AI analysis on, their years, judgements and measures. */
async function work() {
  const [entities, names, checklist, links, bonds, screen] = await Promise.all([catalystRepo.listEntities(), catalystRepo.listNames(), catalystRepo.listChecklist(), catalystRepo.listLinks(), catalystRepo.listBonds(), catalystRepo.listScreen()]);
  const on = entities.filter((e) => e.aiAnalysis?.on);
  const ids = [...new Set(on.flatMap((e) => [e.entityId, ...(e.financialsEntityId ? [e.financialsEntityId] : [])]))];
  const [years, judged, collected, measures] = await Promise.all([
    Promise.all(ids.map(async (id) => [id, (await catalystRepo.listYears(id)).map((y) => ({ periodEnd: y.periodEnd, scope: y.scope, months: y.months, importedAt: y.importedAt }))] as const)),
    Promise.all(on.map(async (e) => [e.entityId, (await catalystRepo.listAnalyses(e.entityId)).sort((a, b) => a.at.localeCompare(b.at)).map((a) => ({ at: a.at, basedOn: a.basedOn })).at(-1)] as const)),
    Promise.all(on.map(async (e) => [e.entityId, (await catalystRepo.listCollectedFigures(e.entityId)).map((a) => a.at).sort().at(-1)] as const)),
    Promise.all(
      on.map(async (e) => {
        const own = links.filter((l) => l.entityId === e.entityId);
        const events = (await Promise.all(own.map((l) => catalystRepo.listEvents(l.isin)))).flat();
        return [e.entityId, events.filter((x) => x.signal === "distress" || x.signal === "attention")] as const;
      }),
    ),
  ]);
  // Who needs a half-year report (plan N8): bonds due within 24 months, or debt service, liquidity or refinancing
  // yellow or red (the signals the metrics copied into its bonds' rows).
  const in24 = addDays(today(), 730);
  const signalsOf = new Map(screen.flatMap((s) => (s.issuer ? [[s.isin, s.issuer] as const] : [])));
  const needsInterim = new Map<string, string>();
  for (const e of on) {
    const own = new Set(links.filter((l) => l.entityId === e.entityId).map((l) => l.isin));
    const listed = bonds.filter((b) => own.has(b.isin) && b.status === "listed");
    const due = listed.filter((b) => b.maturity && b.maturity <= in24).map((b) => b.code);
    const signals = listed.map((b) => signalsOf.get(b.isin)).find(Boolean);
    const weak = (signals?.dimensions ?? []).filter((d) => ["Debt Service", "Liquidity", "Refinancing"].includes(d.name) && (d.signal === "yellow" || d.signal === "red")).map((d) => `${d.name.toLowerCase()} ${d.signal}`);
    const why = [...(due.length ? [`bonds due within 24 months: ${due.join(", ")}`] : []), ...weak];
    if (why.length) needsInterim.set(e.entityId, why.join("; "));
  }
  const namesOf = (id: string) => names.filter((n) => n.entityId === id).map((n) => n.name);
  const lenderByName = (id: string) => namesOf(id).some((n) => financeRuleSetFor(n));
  const defined = <V>(pairs: readonly (readonly [string, V | undefined])[]) => new Map(pairs.filter((p): p is readonly [string, V] => p[1] !== undefined));
  return workItems({
    today: today(),
    entities: on.map(stripKeys),
    names: names.map(stripKeys),
    years: new Map(years),
    judged: defined(judged),
    collected: defined(collected),
    checklist: checklist.map(stripKeys),
    measures: new Map(measures),
    lenderByName,
    needsInterim,
    outOfScope: (e) => !(e.financeRuleSet || e.ruleSetOverride || lenderByName(e.entityId)) && !isInFundamentalScope(e.industry),
  });
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
const SwitchInput = z.object({ on: z.boolean() }).strict();
const RULE_SETS = ["general", "developer", "contractor", "consumer", "collector", "leasing", "investment"] as const;
const EntityInput = z
  .object({
    shortName: z.string().trim().min(1).max(60),
    industry: z.enum(INDUSTRIES),
    financeRuleSet: z.enum(["collector", "leasing", "investment"]).nullable(),
    ruleSetOverride: z.object({ ruleSet: z.enum(RULE_SETS), reason: z.string().trim().min(1).max(300) }).strict().nullable(),
    businessSummary: z.string().trim().min(1).max(1500),
    website: z.string().trim().max(200),
    financialsEntityId: z.string().min(1).max(40).nullable(),
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
    businessSummary: e.businessSummary ?? null,
    website: e.website ?? null,
    financialsEntityId: e.financialsEntityId ?? null,
  };
}

/** A bond row's company fields. */
function company(e: Entity | undefined, entityBy: Map<string, Entity>) {
  // A financing vehicle's group: the bond table lists the vehicle's bonds under it.
  const group = e?.financialsEntityId ? entityBy.get(e.financialsEntityId) : undefined;
  return e
    ? { entityId: e.entityId, issuerShort: e.shortName, issuerLegal: e.legalName, ...(group ? { groupId: group.entityId, groupShort: group.shortName } : {}), aiAnalysis: e.aiAnalysis?.on ?? false, ...(e.aiAnalysis && !e.aiAnalysis.on ? { aiOffSince: e.aiAnalysis.at.slice(0, 10) } : {}), ...(e.industry ? { industry: e.industry } : {}) }
    : {};
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
