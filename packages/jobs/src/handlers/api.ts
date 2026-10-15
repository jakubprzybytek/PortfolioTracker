// HTTP API for the UI (see Docs/ui.md). Reads, plus adding/editing/deleting transactions and adding instruments
// (the "Add transaction" form), new values of hand-valued assets, corporate bonds' coupon periods, and notes. Every route needs a Cognito login (checked by API Gateway) in one of the stage's
// access groups (checked here).

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
  netDepositsByDate,
  checkManualTransaction,
  isCalendarDate,
  listedTreasuryInstrument,
  newTransactionId,
  parseManualPrices,
  retailInstrument,
  addDays,
  adjustForSplits,
  cpiIndicators,
  fxCurrencyOf,
  fxIndicator,
  priceRows,
  retailValueHistory,
  summarize,
  today,
  toReferenceIndex,
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
import { invokeAsync, queueValuation, repo } from "../lib/context.ts";
import { importInstruments, mfTermsByCode } from "./import.ts";

const json = (status: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
/** "Refresh prices" at most this often. */
const REFRESH_EVERY_MS = 5 * 60_000;

/** Comma-separated, set per stage in sst.config.ts (accessGroups). */
const ACCESS_GROUPS = (process.env["ACCESS_GROUPS"] ?? "portfolio-tracker").split(",");

/** JSON body of a POST/PUT (API Gateway may pass it base64-encoded). */
const bodyOf = (event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown => {
  if (!event.body) return undefined;
  return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body);
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
      case "GET /accounts": {
        // Per account (latest snapshot): net deposits, value, cash, profit, income, costs, XIRR; total of the complete ones.
        const [snap, txs] = await Promise.all([repo.getSnapshot("LATEST"), repo.listTransactions()]);
        if (!snap) return json(404, { error: "No valuation yet" });
        // Money in other currencies counts at NBP rates (the day before each transaction; base currencies: today too).
        const first = txs.map((t) => t.date).sort()[0] ?? snap.date;
        const currencies = [...new Set([...txs.flatMap((t) => [t.currency, t.toCurrency ?? "PLN"]), ...Object.values(snap.accounts ?? {}).map((a) => a.baseCurrency ?? "PLN")])].filter((c) => c && c !== "PLN");
        const fx: FxHistory = new Map(await Promise.all(currencies.map(async (c) => [c, (await repo.queryFxRates(c, addDays(first, -14), snap.date)).sort((a, b) => a.date.localeCompare(b.date))] as const)));
        return json(200, { date: snap.date, ...accountSummaries(snap, txs, fx) });
      }
      case "GET /portfolio/history": {
        // Each day: positions, cash, their sum (`total`) and the money put in so far (`netDeposits`, fully tracked
        // accounts, other currencies at NBP D-1), so a sale kept as cash doesn't show as a drop.
        const [snaps, txs, accounts] = await Promise.all([repo.querySnapshots(from, to), repo.listTransactions(), repo.listAccounts()]);
        const currencies = [...new Set(txs.filter((t) => t.type === "DEPOSIT" || t.type === "WITHDRAWAL").map((t) => t.currency))].filter((c) => c && c !== "PLN");
        const first = txs.map((t) => t.date).sort()[0] ?? from;
        const fx: FxHistory = new Map(await Promise.all(currencies.map(async (c) => [c, (await repo.queryFxRates(c, addDays(first, -14), to)).sort((a, b) => a.date.localeCompare(b.date))] as const)));
        const incomplete = new Set(accounts.filter((a) => a.incomplete?.length).map((a) => a.account));
        const deposits = netDepositsByDate(txs, snaps.map((s) => s.date), fx, incomplete);
        return json(
          200,
          snaps.map((s) => ({ date: s.date, totals: s.totals, byType: s.byType, total: Math.round((s.totals.value + (s.totals.cash ?? 0)) * 100) / 100, netDeposits: deposits.get(s.date) ?? 0 })),
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
        const last = (await repo.listJobRuns("live"))[0];
        const retryAt = last ? Date.parse(last.startedAt) + REFRESH_EVERY_MS : 0;
        if (retryAt > Date.now()) return json(429, { error: `Prices were refreshed less than ${REFRESH_EVERY_MS / 60_000} minutes ago.`, retryAt: new Date(retryAt).toISOString() });
        await invokeAsync(Resource.Live.name, {});
        return json(202, { now: new Date().toISOString() });
      }
      case "GET /prices": {
        // Held instruments (latest snapshot): latest price, its date, and the price a year earlier.
        const [snap, instruments] = await Promise.all([repo.getSnapshot("LATEST"), repo.listInstruments()]);
        const held = new Set((snap?.holdings ?? []).filter((h) => h.quantity > 0).map((h) => h.isin));
        // Currencies held (IBKR cash) have no price of their own: their rates are in the Indicators view.
        const shown = instruments.filter((i) => held.has(i.isin) && i.type !== "CURRENCY");
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
      case "GET /status": {
        const jobs = ["eod-gpw", "eod-gpw-recheck", "eod-etf", "eod-catalyst", "eod-bonds", "live", "coupons", "fx", "valuation", "backfill", "import", "monthly", "export"];
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
