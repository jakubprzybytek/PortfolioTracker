// Values the portfolio: one date by default (today), or every day from `from` to `to`.
// Runs only from the FIFO queue (one at a time, in order). A direct invocation (the 22:30/07:30 schedules, or by hand
// with { from, to, reason }) just queues its request, so it can't overlap a run started by an import or backfill.
// Requests waiting together (up to 10, e.g. a burst of saves or an import of several files) make one run, over the
// union of their ranges.
// Days that come out as stored aren't written again (writes are what a run costs); { force: true } writes them all.
// A day's chart point keeps a fingerprint of its snapshot: a day that comes out with the same one is skipped without
// reading its stored snapshot.

import {
  addDays,
  changedPositionDays,
  historyPointChanged,
  historyPointOf,
  mergedRange,
  Ledger,
  toReferenceIndex,
  today,
  valuePortfolio,
  type CouponPeriodItem,
  type FxRateItem,
  type IsoDate,
  type PriceItem,
  snapshotChanged,
  snapshotFingerprint,
  type HistoryPointItem,
  type SnapshotItem,
  type ValuationRequest,
} from "@portfolio/core";
import type { SQSEvent } from "aws-lambda";
import { mapLimit } from "../lib/concurrency.ts";
import { queueValuation, repo, runJob } from "../lib/context.ts";

/** Days valued before their stored snapshots are read (those whose fingerprint differs, in one batch) and written. */
const CHUNK_DAYS = 100;
/** Instruments (prices, coupon periods) and currencies loaded at once. */
const LOAD_CONCURRENCY = 10;

export type ValuationEvent = ValuationRequest;

export async function handler(event: ValuationEvent | SQSEvent = {}) {
  if (!("Records" in event)) {
    await queueValuation(event);
    return { queued: true };
  }
  await revalue(event.Records.map((r) => JSON.parse(r.body) as ValuationEvent));
  return { processed: event.Records.length };
}

async function revalue(requests: ValuationEvent[]) {
  return runJob("valuation", async () => {
    const [instruments, transactions, refIndex, accounts] = await Promise.all([repo.listInstruments(), repo.listTransactions(), repo.listReferenceIndex(), repo.listAccounts()]);
    const referenceIndex = toReferenceIndex(refIndex);
    const tracked = instruments.filter((i) => i.isin !== "MF-TERMS");

    const reasons = [...new Set(requests.map((r) => r.reason ?? "schedule"))].join(", ") + (requests.length > 1 ? `, ${requests.length} requests` : "");
    if (transactions.length === 0) return { itemsWritten: 0, note: `no transactions (${reasons})` };
    // A change dated after today (e.g. a future transaction) touches no valued day yet, nor one of an instrument never held.
    const range = mergedRange(requests, transactions, today());
    if (!range) return { itemsWritten: 0, note: `nothing to value (${reasons})` };
    const { from, to, force } = range;

    // Every price and exchange rate of the whole range once (walked forward below), the interest periods of corporate
    // bonds (accrued interest) and the stored chart points, several at a time. The whole FX history also goes to the
    // valuation (transactions count at the rate of the day before).
    const corporate = tracked.filter((i) => i.type === "BOND_CORPORATE");
    const currencies = [...new Set([...tracked.map((i) => i.currency), ...transactions.flatMap((t) => [t.currency, t.toCurrency ?? "PLN"])].filter((c) => c && c !== "PLN"))];
    const byDate = <T extends { date: IsoDate }>(items: T[]) => items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const [periods, prices, rates, storedPoints] = await Promise.all([
      mapLimit(corporate, LOAD_CONCURRENCY, (i) => repo.listCouponPeriods(i.isin)),
      mapLimit(tracked, LOAD_CONCURRENCY, async (i) => byDate(await repo.queryPrices(i.isin, i.venue, "0000-00-00", to))),
      mapLimit(currencies, LOAD_CONCURRENCY, async (c) => byDate(await repo.queryFxRates(c, "0000-00-00", to))),
      repo.queryHistoryPoints(from, to),
    ]);
    const couponPeriods = new Map<string, CouponPeriodItem[]>(corporate.map((i, n) => [i.isin, periods[n]!]));
    const priceHistory = new Map<string, PriceItem[]>(tracked.map((i, n) => [i.isin, prices[n]!]));
    const fxHistory = new Map<string, FxRateItem[]>(currencies.map((c, n) => [c, rates[n]!]));

    // Walk forward: each series keeps a cursor at its latest item on or before the day.
    const cursor = <T extends { date: IsoDate }>(items: T[]) => {
      let i = -1;
      return (date: IsoDate): T | undefined => {
        while (i + 1 < items.length && items[i + 1]!.date <= date) i++;
        return i >= 0 ? items[i] : undefined;
      };
    };
    const priceAt = [...priceHistory].map(([isin, items]) => [isin, cursor(items)] as const);
    const fxAt = [...fxHistory].map(([c, items]) => [c, cursor(items)] as const);

    // Positions and cash carried from day to day instead of replaying every transaction for each.
    const ledger = new Ledger(transactions, fxHistory);
    const pointsBefore = new Map(storedPoints.map((p) => [p.date, p]));
    let written = 0;
    let unchanged = 0;
    let removed = 0;
    let pointsOnly = 0;
    let read = 0;

    type Day = { date: IsoDate; snapshot: Omit<SnapshotItem, "PK" | "SK">; point: Omit<HistoryPointItem, "PK" | "SK"> };
    const save = async (days: Day[]) => {
      // A day whose stored point has the snapshot's fingerprint is unchanged. The others need the stored snapshot: to
      // compare (a point written before fingerprints may well match), for the positions whose day changed and for the
      // positions gone (one that's gone now, after a transaction was edited or deleted, loses its days too, so its row
      // chart doesn't keep stale days).
      const same = (d: Day) => !force && pointsBefore.get(d.date)?.fingerprint === d.point.fingerprint;
      const toRead = days.filter((d) => !same(d)).map((d) => d.date);
      const before = new Map((toRead.length ? await repo.getSnapshots(toRead) : []).map((s) => [s.date, s]));
      read += before.size;
      const snapshots: Day["snapshot"][] = [];
      const positionDays: { date: IsoDate; holdings: SnapshotItem["holdings"] }[] = [];
      const gone: { account: string; isin: string; date: IsoDate }[] = [];
      const points: Day["point"][] = [];
      let latest: Day["snapshot"] | undefined;
      for (const day of days) {
        const { date, snapshot, point } = day;
        const was = before.get(date);
        if (date === to) latest = snapshot;
        // An unchanged day still gets its point when it has none (days valued before points existed) or a different
        // one (e.g. without a fingerprint yet).
        if (force || historyPointChanged(pointsBefore.get(date), point)) points.push(point);
        if (same(day) || (!force && !snapshotChanged(was, snapshot))) {
          unchanged++;
          continue;
        }
        snapshots.push(snapshot);
        // Per-position history for the Holdings row charts: only the positions whose day changed.
        positionDays.push({ date, holdings: changedPositionDays(force ? undefined : was, snapshot) });
        const now = new Set(snapshot.holdings.map((h) => `${h.account}#${h.isin}`));
        for (const h of was?.holdings ?? []) if (!now.has(`${h.account}#${h.isin}`)) gone.push({ account: h.account, isin: h.isin, date });
      }
      // The days in a few BatchWrites; the chart points after them: a point with a new fingerprint must not stand for a
      // snapshot that wasn't written.
      await repo.writeValuedDays({ snapshots, ...(latest ? { latest } : {}), positionDays, gone });
      await repo.putHistoryPoints(points);
      written += snapshots.length;
      removed += gone.length;
      pointsOnly += points.length - snapshots.length;
    };

    let days: Day[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const prices = new Map<string, PriceItem>();
      for (const [isin, at] of priceAt) {
        const p = at(date);
        if (p) prices.set(isin, p);
      }
      const fx = new Map<string, { mid: number; date: IsoDate }>();
      for (const [c, at] of fxAt) {
        const r = at(date);
        if (r) fx.set(c, { mid: r.mid, date: r.date });
      }
      const snapshot = valuePortfolio({ date, instruments: tracked, transactions, prices, referenceIndex, couponPeriods, accounts, fx, fxHistory, ledger });
      days.push({ date, snapshot, point: { ...historyPointOf(snapshot), fingerprint: snapshotFingerprint(snapshot) } });
      if (days.length === CHUNK_DAYS || date === to) {
        await save(days);
        days = [];
      }
    }
    const notes = [
      unchanged ? `${unchanged} days unchanged` : "",
      pointsOnly ? `${pointsOnly} of them only their chart point written` : "",
      removed ? `${removed} days of positions gone removed` : "",
      read ? `${read} stored snapshots read` : "",
    ].filter(Boolean);
    return { itemsWritten: written, note: `${from} → ${to} (${reasons})${notes.map((n) => `; ${n}`).join("")}` };
  });
}
