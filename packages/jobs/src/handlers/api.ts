// HTTP API for the UI (see Docs/ui.md). Reads, plus adding/editing/deleting transactions and adding instruments
// (the "Add transaction" form), new values of hand-valued assets, corporate bonds' coupon periods, and notes. Every route needs a Cognito login (checked by API Gateway) in one of the stage's
// access groups (checked here). The one route without a login, the spreadsheet feed, is a function of its own (feed.ts).

import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from "aws-lambda";
import { Resource } from "sst";
import {
  APP_SOURCE,
  CouponPeriodInput,
  couponChecks,
  CPI_INDICATORS,
  InstrumentInput,
  ManualTransaction,
  NewInstrument,
  NoteFields,
  newNoteId,
  corporateInstrument,
  etfInstrument,
  manualInstrument,
  accountSummaries,
  closedPositions,
  formerInstruments,
  pitYears,
  salesOf,
  cashFlows,
  positionFlows,
  positionsAt,
  netDepositsByDate,
  withZeroGaps,
  checkManualTransaction,
  isCalendarDate,
  listedTreasuryInstrument,
  newTransactionId,
  parseManualPrices,
  retailInstrument,
  addDays,
  adjustForSplits,
  DEFAULT_ASSUMPTIONS,
  HoldSellAssumptionsInput,
  holdOrSell,
  offerSeriesCode,
  RETAIL_OFFER_TERMS,
  type HoldSellAssumptions,
  type RetailTerms,
  TargetsInput,
  type Targets,
  ASSET_CLASSES,
  defaultAssetClass,
  cpiIndicators,
  cpiLevels,
  yearlyReturns,
  fxCurrencyOf,
  fxIndicator,
  priceRows,
  retailValueHistory,
  summarize,
  today,
  toReferenceIndex,
  shiftMonth,
  valueBond,
  yearBefore,
  type FxHistory,
  type IndicatorSummary,
  type InstrumentItem,
  type InterestPeriod,
  type NoteItem,
  type PriceItem,
  type TransactionItem,
} from "@portfolio/core";
import { FX_CURRENCIES } from "./fx.ts";
import { hasAnyGroup } from "../lib/access.ts";
import { FEED_TOKEN_SETTING, newFeedToken, type FeedToken } from "../lib/feedToken.ts";
import { invokeAsync, queueValuation, repo } from "../lib/context.ts";
import { importInstruments, mfTermsByCode } from "./import.ts";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * Each day in [from, to]: positions, cash, their sum (`total`) and the money put in so far (`netDeposits`, fully
 * tracked accounts, other currencies at NBP D-1), so a sale kept as cash doesn't show as a drop. `byClass`: shares,
 * bonds, cash, other (the allocation over time). Read from the days' chart points, not the snapshots (a snapshot is
 * ~60× bigger: years of them took seconds).
 */
async function portfolioHistory(from: string, to: string) {
  const [points, txs, accounts] = await Promise.all([repo.queryHistoryPoints(from, to), repo.listTransactions(), repo.listAccounts()]);
  const currencies = [...new Set(txs.filter((t) => t.type === "DEPOSIT" || t.type === "WITHDRAWAL").map((t) => t.currency))].filter((c) => c && c !== "PLN");
  const first = txs.map((t) => t.date).sort()[0] ?? from;
  const fx: FxHistory = new Map(await Promise.all(currencies.map(async (c) => [c, (await repo.queryFxRates(c, addDays(first, -14), to)).sort((a, b) => a.date.localeCompare(b.date))] as const)));
  const incomplete = new Set(accounts.filter((a) => a.incomplete?.length).map((a) => a.account));
  const deposits = netDepositsByDate(txs, points.map((p) => p.date), fx, incomplete);
  return points.map((p) => ({ date: p.date, totals: p.totals, byType: p.byType, byClass: p.byClass, total: Math.round((p.totals.value + (p.totals.cash ?? 0)) * 100) / 100, netDeposits: deposits.get(p.date) ?? 0 }));
}
/** "Refresh prices" at most this often. */
const REFRESH_EVERY_MS = 5 * 60_000;

/** Comma-separated, set per stage in sst.config.ts (accessGroups). */
const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");

/** A request the API refuses with a 400 and this message, wherever it's found. */
class BadRequest extends Error {}

/** JSON body of a POST/PUT (API Gateway may pass it base64-encoded); not JSON → 400. */
const bodyOf = (event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown => {
  if (!event.body) return undefined;
  try {
    return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
  } catch {
    throw new BadRequest("The request body isn't valid JSON");
  }
};

type TxOut = Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
const withoutKeys = ({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...rest }: TransactionItem): TxOut => rest;

/**
 * Validates a transaction from the form and stores it (new id, or `id` when editing). A buy of a manually valued
 * asset also records its price that day, so it has a value. Then revalues from the earliest day touched.
 */
async function saveTransaction(input: unknown, existing?: TransactionItem): Promise<APIGatewayProxyResultV2> {
  const parsed = ManualTransaction.safeParse(input);
  if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
  const t = parsed.data;
  const instruments = await repo.listInstruments();
  const problems = checkManualTransaction(t, new Set(instruments.map((i) => i.isin)));
  if (problems.length) return json(400, { error: problems.join("; ") });
  const item: TxOut = { ...t, id: existing?.id ?? newTransactionId(), source: existing?.source ?? APP_SOURCE };
  if (existing && (existing.date !== item.date || existing.account !== item.account)) await repo.deleteTransaction(existing);
  await repo.putTransactions([item]);
  const inst = t.isin ? instruments.find((i) => i.isin === t.isin) : undefined;
  if (inst?.type === "FUND_MANUAL" && t.type === "BUY" && t.price) await repo.putPrices(parseManualPrices(JSON.stringify([{ isin: inst.isin, date: t.date, price: t.price }]), APP_SOURCE));
  const from = existing && existing.date < item.date ? existing.date : item.date;
  await queueValuation({ reason: existing ? "transaction edited" : "transaction added", from });
  return json(existing ? 200 : 201, item);
}

/** A treasury series by code: retail (EDO1036 …) from the Ministry file, listed (DS1030 …) from the MF calculator terms. */
async function treasurySeries(code: string): Promise<InstrumentInput | undefined> {
  const retail = await repo.getRetailSeries(code);
  if (retail) return retailInstrument(retail);
  const listed = (await mfTermsByCode()).get(code);
  return listed ? listedTreasuryInstrument(listed) : undefined;
}

/** A corporate bond by ISIN, or the error response. */
/** Where the hold-or-sell assumptions are kept (settings). */
const HOLD_SELL_SETTING = "holdSell";
/** Where the target allocation is kept (settings). */
const TARGETS_SETTING = "targets";

/**
 * The retail series on sale on `day` (the alternatives): each kind's series of this month, or of the month before
 * when this month's isn't in the Ministry file yet (the monthly job brings it).
 */
async function retailOffers(day: string): Promise<RetailTerms[]> {
  const month = day.slice(0, 7);
  const found = await Promise.all(
    RETAIL_OFFER_TERMS.map(async ({ kind, months }) => {
      for (const m of [month, shiftMonth(month, -1)]) {
        const s = await repo.getRetailSeries(offerSeriesCode(kind, months, m));
        if (s) {
          const { PK: _p, SK: _s, source: _src, updatedAt: _u, ...terms } = s;
          return terms;
        }
      }
      return undefined;
    }),
  );
  return found.filter((t): t is RetailTerms => !!t);
}

async function corporateBond(isin: string | undefined): Promise<{ inst: InstrumentItem } | { error: APIGatewayProxyResultV2 }> {
  if (!isin || !ISIN.test(isin)) return { error: json(400, { error: "Invalid ISIN" }) };
  const inst = await repo.getInstrument(isin);
  if (!inst) return { error: json(404, { error: "Unknown instrument" }) };
  if (inst.type !== "BOND_CORPORATE" || !inst.nominal) return { error: json(400, { error: `${inst.code} isn't a corporate bond: no coupon periods` }) };
  return { inst };
}

const noteOf = ({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...n }: NoteItem) => n;

const periodOf = ({ PK: _p, SK: _s, updatedAt: _u, ...p }: InterestPeriod & { PK?: unknown; SK?: unknown; updatedAt?: unknown }): InterestPeriod => p;

/**
 * Adds a period (POST, no `existing`) or changes one (PUT): the dates and the rate from the form. Dates or a rate that
 * differ from what's stored become "manual" (`rateSource` may say "coupons" or "obligacje.pl" when you accept the rate
 * those gave); a rate set by you settles `otherRate`. Then revalues from the period's start.
 */
async function savePeriod(inst: InstrumentItem, body: unknown, existing?: InterestPeriod): Promise<APIGatewayProxyResultV2> {
  const b = (body ?? {}) as Record<string, unknown>;
  const stored = await repo.listCouponPeriods(inst.isin);
  // A field left out keeps its value; null clears the record day or the rate.
  const pick = <K extends "end" | "recordDate" | "paymentDate" | "rate">(k: K) => (b[k] === null ? undefined : b[k] !== undefined ? b[k] : existing?.[k]);
  const end = pick("end");
  const recordDate = pick("recordDate");
  const paymentDate = pick("paymentDate");
  const rate = pick("rate");
  const datesChanged = !existing || end !== existing.end || recordDate !== existing.recordDate || paymentDate !== existing.paymentDate;
  const rateChanged = rate !== existing?.rate;
  const rateSource = rate === undefined ? undefined : typeof b["rateSource"] === "string" ? b["rateSource"] : rateChanged ? "manual" : existing?.rateSource;
  const candidate = {
    isin: inst.isin,
    start: existing?.start ?? b["start"],
    end,
    ...(recordDate !== undefined ? { recordDate } : {}),
    paymentDate,
    datesSource: datesChanged ? "manual" : existing.datesSource,
    ...(rate !== undefined ? { rate, rateSource } : {}),
    // Kept until a rate is set (yours, or one you accept).
    ...(existing?.otherRate && !rateChanged && !b["rateSource"] ? { otherRate: existing.otherRate } : {}),
  };
  const parsed = CouponPeriodInput.safeParse(candidate);
  if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
  const p = parsed.data;
  const clash = stored.find((o) => o.start !== p.start && o.start < p.end && p.start < o.end);
  if (clash) return json(400, { error: `Overlaps the period ${clash.start} – ${clash.end}` });
  if (!existing && stored.some((o) => o.start === p.start)) return json(409, { error: `A period starting ${p.start} exists` });
  await repo.putCouponPeriods([p]);
  await queueValuation({ reason: existing ? "coupon period edited" : "coupon period added", from: p.start });
  return json(existing ? 200 : 201, p);
}

/** NBP rates of every currency in the transactions (and `more`), from a fortnight before the first one to `to`. */
async function fxHistoryOf(txs: TransactionItem[], to: string, more: string[] = []): Promise<FxHistory> {
  const first = txs.map((t) => t.date).sort()[0] ?? to;
  const currencies = [...new Set([...txs.flatMap((t) => [t.currency, t.toCurrency ?? "PLN"]), ...more])].filter((c) => c && c !== "PLN");
  return new Map(await Promise.all(currencies.map(async (c) => [c, (await repo.queryFxRates(c, addDays(first, -14), to)).sort((a, b) => a.date.localeCompare(b.date))] as const)));
}

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
        // `flows`: each position's own cash flows to the snapshot's day (PLN, NBP D-1), for the XIRR of any row or group.
        // `?closed=1`: also the positions held no more (`closed`: realised gain, coupons, open and close dates).
        const [snap, txs] = await Promise.all([repo.getSnapshot("LATEST"), repo.listTransactions()]);
        if (!snap) return json(404, { error: "No valuation yet" });
        const fx = await fxHistoryOf(txs, today());
        const flows = positionFlows(txs, snap.date, fx);
        if (q["closed"] !== "1") return json(200, { ...snap, flows });
        const instruments = await repo.listInstruments();
        const positions = positionsAt(txs, today(), fx);
        return json(200, { ...snap, flows, closed: closedPositions(positions.values(), instruments) });
      }
      case "GET /cash-flows": {
        // Deposits and withdrawals per account and month of `?year=` (default this year), and the spreadsheet feed's state.
        const year = q["year"] ?? today().slice(0, 4);
        if (!/^\d{4}$/.test(year)) return json(400, { error: "year: four digits" });
        const [txs, token] = await Promise.all([repo.listTransactions(), repo.getSetting<FeedToken>(FEED_TOKEN_SETTING)]);
        const report = cashFlows(txs, Number(year), await fxHistoryOf(txs, today()));
        return json(200, { ...report, feed: token ? { createdAt: token.createdAt, lastUsedAt: token.lastUsedAt ?? null } : null });
      }
      case "POST /feed-token": {
        // A new token for the feed, replacing any before it (that one stops working at once); returned only here.
        const { token, stored } = newFeedToken();
        await repo.putSetting(FEED_TOKEN_SETTING, stored);
        return json(201, { token, createdAt: stored.createdAt });
      }
      case "DELETE /feed-token": {
        await repo.deleteSetting(FEED_TOKEN_SETTING);
        return json(200, { feed: null });
      }
      case "GET /sales": {
        // Every sale, redemption and write-off with its FIFO pairs (newest first), and per year the PIT-38 summary.
        const [txs, instruments] = await Promise.all([repo.listTransactions(), repo.listInstruments()]);
        const sales = salesOf(positionsAt(txs, today(), await fxHistoryOf(txs, today())).values(), instruments);
        return json(200, { sales, years: pitYears(sales) });
      }
      case "GET /accounts": {
        // Per account (latest snapshot): net deposits, value, cash, profit, income, costs, XIRR; total of the complete ones.
        const [snap, txs] = await Promise.all([repo.getSnapshot("LATEST"), repo.listTransactions()]);
        if (!snap) return json(404, { error: "No valuation yet" });
        // Money in other currencies counts at NBP rates (the day before each transaction; base currencies: today too).
        const fx = await fxHistoryOf(txs, snap.date, Object.values(snap.accounts ?? {}).map((a) => a.baseCurrency ?? "PLN"));
        return json(200, { date: snap.date, ...accountSummaries(snap, txs, fx) });
      }
      case "GET /portfolio/history":
        return json(200, await portfolioHistory(from, to));
      case "GET /portfolio/years": {
        // Per calendar year and over the whole history: start and end value, money put in, profit, time-weighted and
        // money-weighted return, inflation over the same days (CPI: GUS since December, else the monthly chain) and the
        // real return; plus the CPI levels from the first day on, for the growth of 100 zł chart (`growthOf100`).
        const [points, ytd, mom] = await Promise.all([portfolioHistory("2000-01-01", today()), repo.listGusCpi("CPI_YTD"), repo.listReferenceIndex()]);
        const levels = cpiLevels(ytd, mom);
        const start = points[0] ? shiftMonth(points[0].date.slice(0, 7), -1) : "9999-12";
        return json(200, { ...yearlyReturns(points, levels), cpi: levels.filter((l) => l.month >= start) });
      }
      case "GET /instruments": {
        const items = (await repo.listInstruments()).filter((i) => i.isin !== "MF-TERMS");
        const statuses = await repo.listBackfillStatuses(items.map((i) => i.isin));
        const withStatus = items.map((i) => ({ ...i, backfill: statuses.get(i.isin) }));
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
        // On today's share basis: closes before a split are divided by its ratio, so the line has no cliff.
        const prices = adjustForSplits(await repo.queryPrices(isin, inst.venue, from, to), inst.splits);
        // Inflation-linked bonds: the indexed nominal per bond on each day (1000 × index ratio), drawn on its own axis.
        const indexed = inst.terms?.couponType === "INDEXED" ? { terms: inst.terms, referenceIndex: toReferenceIndex(await repo.listReferenceIndex()) } : null;
        return json(
          200,
          prices.map(({ PK: _p, SK: _s, ...rest }) => {
            if (!indexed) return rest;
            const v = valueBond(indexed.terms, rest.date, { referenceIndex: indexed.referenceIndex });
            return { ...rest, nominal: v.problem ? null : v.nominal };
          }),
        );
      }
      case "POST /instruments/{isin}/prices": {
        // A new value of a hand-valued asset (venue MANUAL): { date, price } per unit in the instrument's currency.
        if (!isin || !ISIN.test(isin)) return json(400, { error: "Invalid ISIN" });
        const inst = await repo.getInstrument(isin);
        if (!inst) return json(404, { error: "Unknown instrument" });
        if (inst.venue !== "MANUAL") return json(400, { error: `${inst.code} has a price source; only hand-valued assets take a value here` });
        const body = bodyOf(event) as { date?: unknown; price?: unknown; note?: unknown } | undefined;
        const date = typeof body?.date === "string" ? body.date : "";
        const price = typeof body?.price === "number" ? body.price : NaN;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isCalendarDate(date)) return json(400, { error: "date: needs a date (YYYY-MM-DD)" });
        if (date > addDays(today(), 1)) return json(400, { error: "date: not in the future" }); // a day ahead: UTC vs the user's clock
        if (!(price > 0)) return json(400, { error: "price: needs a positive number" });
        const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;
        const [item] = parseManualPrices(JSON.stringify([{ isin, date, price, currency: inst.currency, ...(note ? { note } : {}) }]), APP_SOURCE);
        await repo.putPrices([item!]);
        await queueValuation({ reason: "value entered", from: date });
        const { PK: _p, SK: _s, ...out } = item!;
        return json(201, out);
      }
      case "DELETE /instruments/{isin}/prices/{date}": {
        const date = event.pathParameters?.["date"] ?? "";
        if (!isin || !ISIN.test(isin) || !isCalendarDate(date)) return json(400, { error: "Needs an ISIN and a date" });
        const inst = await repo.getInstrument(isin);
        if (!inst || inst.venue !== "MANUAL") return json(400, { error: "Only values entered by hand can be deleted" });
        const [existing] = await repo.queryPrices(isin, "MANUAL", date, date);
        if (!existing) return json(404, { error: `No value on ${date}` });
        await repo.deletePrice(isin, "MANUAL", date);
        await queueValuation({ reason: "value deleted", from: date });
        return json(200, { isin, date });
      }
      case "PUT /instruments/{isin}/asset-class": {
        // { assetClass }: the class set by hand; the rule's class (or null) clears it. The instrument's days are
        // revalued from its first transaction, so the allocation charts follow.
        if (!isin || !ISIN.test(isin)) return json(400, { error: "Invalid ISIN" });
        const inst = await repo.getInstrument(isin);
        if (!inst) return json(404, { error: "Unknown instrument" });
        const body = bodyOf(event) as { assetClass?: unknown } | undefined;
        const wanted = body?.assetClass ?? null;
        if (wanted !== null && !ASSET_CLASSES.includes(wanted as (typeof ASSET_CLASSES)[number])) return json(400, { error: `assetClass: one of ${ASSET_CLASSES.join(", ")} (or null: the rule)` });
        const rule = defaultAssetClass(inst);
        const assetClass = wanted === null || wanted === rule ? undefined : (wanted as (typeof ASSET_CLASSES)[number]);
        if (assetClass === inst.assetClass) return json(200, { isin, assetClass: assetClass ?? rule, set: !!assetClass });
        const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _gs, updatedAt: _u, assetClass: _a, ...rest } = inst;
        await repo.putInstrument({ ...rest, ...(assetClass ? { assetClass } : {}) });
        await queueValuation({ reason: "asset class changed", isins: [isin] });
        return json(200, { isin, assetClass: assetClass ?? rule, set: !!assetClass });
      }
      case "GET /instruments/{isin}/coupons": {
        // The bond's periods (oldest first), with the coupons you received matched to them: the rate each implies and
        // whether it fits the stored rate.
        const found = await corporateBond(isin);
        if ("error" in found) return found.error;
        const { inst } = found;
        const [periods, txs] = await Promise.all([repo.listCouponPeriods(inst.isin), repo.listTransactions()]);
        const own = txs.filter((t) => t.isin === inst.isin);
        const checks = couponChecks(periods, inst.nominal!, own, inst.isin);
        return json(200, { isin: inst.isin, code: inst.code, nominal: inst.nominal, periods: periods.map(periodOf), coupons: checks.periods, unmatched: checks.unmatched.map(withoutKeys) });
      }
      case "POST /instruments/{isin}/coupons": {
        const found = await corporateBond(isin);
        if ("error" in found) return found.error;
        const { inst } = found;
        return await savePeriod(inst, bodyOf(event));
      }
      case "PUT /instruments/{isin}/coupons/{start}":
      case "DELETE /instruments/{isin}/coupons/{start}": {
        const found = await corporateBond(isin);
        if ("error" in found) return found.error;
        const { inst } = found;
        const start = event.pathParameters?.["start"] ?? "";
        const existing = (await repo.listCouponPeriods(inst.isin)).find((p) => p.start === start);
        if (!existing) return json(404, { error: `No period starting ${start}` });
        if (route.startsWith("PUT")) return await savePeriod(inst, bodyOf(event), periodOf(existing));
        await repo.deleteCouponPeriod(inst.isin, start);
        await queueValuation({ reason: "coupon period deleted", from: start });
        return json(200, periodOf(existing));
      }
      case "GET /indicators": {
        // One row per indicator: latest value and the one a year earlier (series via /indicators/{id}).
        const cpi = cpiIndicators(await repo.listReferenceIndex()).map((i) => summarize(i, i.points));
        const fx = await Promise.all(
          FX_CURRENCIES.map(async (c): Promise<IndicatorSummary> => {
            const last = await repo.latestFxRate(c, today());
            const before = last && (await repo.latestFxRate(c, yearBefore(last.date)));
            return { ...fxIndicator(c), latest: last ? { date: last.date, value: last.mid } : null, yearAgo: before ? { date: before.date, value: before.mid } : null };
          }),
        );
        return json(200, [...cpi, ...fx]);
      }
      case "GET /indicators/{id}": {
        // Points in [from, to] (monthly indicators compare by month), oldest first.
        const id = event.pathParameters?.["id"] ?? "";
        const currency = fxCurrencyOf(id);
        if (currency) {
          if (!FX_CURRENCIES.includes(currency)) return json(404, { error: `No indicator ${id}` });
          const rates = await repo.queryFxRates(currency, from, to);
          return json(200, rates.map((r) => ({ date: r.date, value: r.mid })));
        }
        if (!CPI_INDICATORS.some((i) => i.id === id)) return json(404, { error: `No indicator ${id}` });
        const series = cpiIndicators(await repo.listReferenceIndex()).find((i) => i.id === id)!;
        return json(200, series.points.filter((p) => p.date >= from.slice(0, 7) && p.date <= to.slice(0, 7)));
      }
      case "POST /prices/refresh": {
        // "Refresh prices": starts the Live job (today's quotes, then a revaluation of today). At most one every few
        // minutes, so the sources aren't asked over and over.
        const last = await repo.latestJobRun("live");
        const retryAt = last ? Date.parse(last.startedAt) + REFRESH_EVERY_MS : 0;
        if (retryAt > Date.now()) return json(429, { error: `Prices were refreshed less than ${REFRESH_EVERY_MS / 60_000} minutes ago.`, retryAt: new Date(retryAt).toISOString() });
        await invokeAsync(Resource.Live.name, {});
        return json(202, { now: new Date().toISOString() });
      }
      case "GET /prices": {
        // Held instruments (latest snapshot): latest price, its date, and the price a year earlier. `?closed=1`: also
        // the instruments traded but held no more (`closed`), with the year up to their last price; never stale.
        const withClosed = q["closed"] === "1";
        const [snap, instruments, txs] = await Promise.all([repo.getSnapshot("LATEST"), repo.listInstruments(), withClosed ? repo.listTransactions() : Promise.resolve([])]);
        const held = new Set((snap?.holdings ?? []).filter((h) => h.quantity > 0).map((h) => h.isin));
        const former = formerInstruments(txs, held);
        // Currencies held (IBKR cash) have no price of their own: their rates are in the Indicators view.
        const shown = instruments.filter((i) => (held.has(i.isin) || former.has(i.isin)) && i.type !== "CURRENCY");
        const day = today();
        const latest = new Map<string, PriceItem>();
        const yearAgo = new Map<string, PriceItem>();
        await Promise.all(
          shown.filter((i) => i.type !== "BOND_RETAIL").map(async (i) => {
            const now = await repo.latestPrice(i.isin, i.venue, day);
            const then = await repo.latestPrice(i.isin, i.venue, addDays(former.has(i.isin) && now ? now.date : day, -365));
            if (now) latest.set(i.isin, now);
            if (then) yearAgo.set(i.isin, then);
          }),
        );
        const rates = new Map((snap?.holdings ?? []).filter((h) => h.rate).map((h) => [h.isin, h.rate!] as const));
        return json(
          200,
          priceRows(shown, latest, yearAgo, day, 7, rates).map((r) => {
            const f = former.get(r.isin);
            return f ? { ...r, stale: false, closed: f } : r;
          }),
        );
      }
      case "GET /holdings/history": {
        // One position's daily value and cost (`account` + `isin`), or an instrument's total across the accounts
        // that hold it now (`isin` only).
        const id = q["isin"];
        if (!id || !ISIN.test(id)) return json(400, { error: "Invalid ISIN" });
        // Held nowhere now (a closed position): every account that traded it.
        let accounts = q["account"] ? [q["account"]] : [...new Set(((await repo.getSnapshot("LATEST"))?.holdings ?? []).filter((h) => h.isin === id).map((h) => h.account))];
        if (accounts.length === 0) accounts = [...new Set((await repo.listTransactions()).filter((t) => t.isin === id).map((t) => t.account))];
        const byDate = new Map<string, { date: string; value: number; cost: number; quantity: number }>();
        for (const a of accounts)
          for (const d of await repo.queryPositionDays(a, id, from, to)) {
            const p = byDate.get(d.date) ?? { date: d.date, value: 0, cost: 0, quantity: 0 };
            p.value = Math.round((p.value + (d.value ?? 0)) * 100) / 100;
            p.cost = Math.round((p.cost + d.cost) * 100) / 100;
            p.quantity += d.quantity;
            byDate.set(d.date, p);
          }
        // Days it wasn't held (sold out and bought back later): zero, not a line across.
        return json(200, withZeroGaps([...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))));
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
      case "POST /transactions":
        return await saveTransaction(bodyOf(event));
      case "PUT /transactions/{id}":
      case "DELETE /transactions/{id}": {
        const id = event.pathParameters?.["id"];
        const account = q["account"];
        if (!id || !account) return json(400, { error: "Needs the transaction id and ?account=" });
        const existing = await repo.findTransaction(account, id);
        if (!existing) return json(404, { error: `No transaction ${id} in ${account}` });
        if (route.startsWith("PUT")) return await saveTransaction(bodyOf(event), existing);
        await repo.deleteTransaction(existing);
        await queueValuation({ reason: "transaction deleted", from: existing.date });
        return json(200, withoutKeys(existing));
      }
      case "GET /instruments/lookup": {
        // A code typed in the form: an instrument already tracked, or a treasury series to add.
        const code = (q["code"] ?? "").trim().toUpperCase();
        if (!code) return json(400, { error: "Needs ?code=" });
        const tracked = (await repo.listInstruments()).find((i) => i.code.toUpperCase() === code || i.isin === code);
        if (tracked) return json(200, { tracked: true, instrument: tracked });
        const found = await treasurySeries(code);
        return found ? json(200, { tracked: false, instrument: found }) : json(404, { error: `${code}: no such treasury series in the Ministry data` });
      }
      case "POST /instruments": {
        // Either a full instrument (as in an import file) or { kind, … } from the form, completed here.
        const body = bodyOf(event) as { kind?: string } | undefined;
        let input: InstrumentInput | undefined;
        if (body?.kind) {
          const n = NewInstrument.safeParse(body);
          if (!n.success) return json(400, { error: n.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
          const d = n.data;
          input =
            d.kind === "treasury" ? await treasurySeries(d.code.toUpperCase()) : d.kind === "etf" ? etfInstrument(d) : d.kind === "corporate" ? corporateInstrument(d) : manualInstrument(d);
          if (!input) return json(400, { error: d.kind === "treasury" ? `${d.code}: no such treasury series in the Ministry data` : "Unknown exchange: use e.g. AMS:VWRL, FRA:EUNK, LON:CSPX" });
        } else {
          const parsed = InstrumentInput.safeParse(body);
          if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
          input = parsed.data;
        }
        if (await repo.getInstrument(input.isin)) return json(409, { error: `${input.code} (${input.isin}) is already tracked` });
        await importInstruments(JSON.stringify([input])); // starts its price history backfill (and FX rates)
        return json(201, await repo.getInstrument(input.isin));
      }
      case "GET /instruments/{isin}/transactions": {
        if (!isin || !ISIN.test(isin)) return json(400, { error: "Invalid ISIN" });
        const txs = (await repo.listTransactions()).filter((t) => t.isin === isin);
        return json(200, txs.map(withoutKeys));
      }
      case "GET /notes": {
        // All notes, the last changed first.
        const notes = (await repo.listNotes()).map(noteOf);
        return json(200, notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      case "POST /notes":
      case "PUT /notes/{id}": {
        const parsed = NoteFields.safeParse(bodyOf(event));
        if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
        const now = new Date().toISOString();
        let existing: NoteItem | undefined;
        if (route.startsWith("PUT")) {
          existing = await repo.getNote(event.pathParameters?.["id"] ?? "");
          if (!existing) return json(404, { error: "No such note" });
        }
        const note = { ...parsed.data, id: existing?.id ?? newNoteId(), createdAt: existing?.createdAt ?? now, updatedAt: now };
        await repo.putNotes([note]);
        return json(existing ? 200 : 201, note);
      }
      case "DELETE /notes/{id}": {
        const existing = await repo.getNote(event.pathParameters?.["id"] ?? "");
        if (!existing) return json(404, { error: "No such note" });
        await repo.deleteNote(existing.id);
        return json(200, noteOf(existing));
      }
      case "GET /hold-sell": {
        // Every bond position kept to maturity vs sold today (core/holdsell), with the assumptions and the offers used.
        const [snap, instruments, txs, refIndex, saved] = await Promise.all([repo.getSnapshot("LATEST"), repo.listInstruments(), repo.listTransactions(), repo.listReferenceIndex(), repo.getSetting<HoldSellAssumptions>(HOLD_SELL_SETTING)]);
        if (!snap) return json(404, { error: "No valuation yet" });
        const day = snap.date;
        const offers = await retailOffers(day);
        // The NBP reference rate by default: the ROR on offer pays it (+ its margin) from its second month.
        const ror = offers.find((o) => o.kind === "ROR");
        const defaults: HoldSellAssumptions = { ...DEFAULT_ASSUMPTIONS, ...(ror?.rates[1] != null ? { nbpRate: ror.rates[1] - (ror.margin ?? 0) } : {}) };
        const assumptions: HoldSellAssumptions = { ...defaults, ...saved };
        const held = new Set(snap.holdings.map((h) => h.isin));
        const corporate = instruments.filter((i) => i.type === "BOND_CORPORATE" && held.has(i.isin));
        const periods = await Promise.all(corporate.map((i) => repo.listCouponPeriods(i.isin)));
        const result = holdOrSell({
          today: day,
          holdings: snap.holdings,
          instruments: new Map(instruments.map((i) => [i.isin, i])),
          transactions: txs,
          couponPeriods: new Map(corporate.map((i, n) => [i.isin, periods[n]!.map(periodOf)])),
          referenceIndex: toReferenceIndex(refIndex),
          offers,
          assumptions,
        });
        return json(200, {
          date: day,
          assumptions,
          defaults,
          saved: !!saved,
          offers: offers.map((o) => ({ series: o.series, kind: o.kind, termMonths: o.termMonths, firstRate: o.rates[0] ?? null, margin: o.margin ?? null, saleStart: o.saleStart, saleEnd: o.saleEnd })),
          ...result,
        });
      }
      case "PUT /hold-sell/assumptions": {
        // The assumptions to keep; { reset: true } goes back to the defaults.
        const body = bodyOf(event) as Record<string, unknown> | undefined;
        if (body?.["reset"] === true) {
          await repo.deleteSetting(HOLD_SELL_SETTING);
          return json(200, { reset: true });
        }
        const parsed = HoldSellAssumptionsInput.safeParse(body);
        if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
        await repo.putSetting(HOLD_SELL_SETTING, parsed.data);
        return json(200, parsed.data);
      }
      case "GET /targets": {
        // The target share and band per asset class (road map 8); null until set.
        return json(200, { targets: (await repo.getSetting<Targets>(TARGETS_SETTING)) ?? null });
      }
      case "PUT /targets": {
        // The targets to keep; { reset: true } removes them.
        const body = bodyOf(event) as Record<string, unknown> | undefined;
        if (body?.["reset"] === true) {
          await repo.deleteSetting(TARGETS_SETTING);
          return json(200, { targets: null });
        }
        const parsed = TargetsInput.safeParse(body);
        if (!parsed.success) return json(400, { error: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
        await repo.putSetting(TARGETS_SETTING, parsed.data);
        return json(200, { targets: parsed.data });
      }
      case "GET /status": {
        const jobs = ["eod-gpw", "eod-gpw-recheck", "eod-etf", "eod-catalyst", "eod-bonds", "live", "coupons", "fx", "valuation", "backfill", "import", "monthly", "export"];
        const runs = Object.fromEntries(await Promise.all(jobs.map(async (j) => [j, (await repo.latestJobRun(j)) ?? null])));
        return json(200, { now: new Date().toISOString(), jobs: runs });
      }
      default:
        return json(404, { error: `No route ${route}` });
    }
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: err.message });
    // The details (table names, SDK messages) stay in the log; the browser gets the request id to find them.
    const requestId = event.requestContext.requestId;
    console.error(`${route} failed (request ${requestId}):`, err);
    return json(500, { error: `Something went wrong on the server (request ${requestId})` });
  }
}
