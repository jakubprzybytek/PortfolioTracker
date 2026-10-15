// Values the portfolio: one date by default (today), or every day from `from` to `to`.
// Runs only from the FIFO queue (one at a time, in order). A direct invocation (the 22:30/07:30 schedules, or by hand
// with { from, to, reason }) just queues its request, so it can't overlap a run started by an import or backfill.
// Days that come out as stored aren't written again (writes are what a run costs); { force: true } writes them all.

import {
  addDays,
  changedPositionDays,
  firstTransactionDate,
  toReferenceIndex,
  today,
  valuePortfolio,
  type CouponPeriodItem,
  type FxRateItem,
  type IsoDate,
  type PriceItem,
  snapshotChanged,
} from "@portfolio/core";
import type { SQSEvent } from "aws-lambda";
import { queueValuation, repo, runJob } from "../lib/context.ts";

export interface ValuationEvent {
  from?: IsoDate;
  to?: IsoDate;
  reason?: string;
  /** Write every day even if unchanged (e.g. after a change to what a position day stores). */
  force?: boolean;
}

export async function handler(event: ValuationEvent | SQSEvent = {}) {
  if (!("Records" in event)) {
    await queueValuation(event);
    return { queued: true };
  }
  for (const record of event.Records) await revalue(JSON.parse(record.body) as ValuationEvent);
  return { processed: event.Records.length };
}

async function revalue(event: ValuationEvent) {
  return runJob("valuation", async () => {
    const [instruments, transactions, refIndex, accounts] = await Promise.all([repo.listInstruments(), repo.listTransactions(), repo.listReferenceIndex(), repo.listAccounts()]);
    const referenceIndex = toReferenceIndex(refIndex);
    const tracked = instruments.filter((i) => i.isin !== "MF-TERMS");

    const to = event.to ?? today();
    const from = event.from ?? (event.reason && event.reason !== "schedule" ? (firstTransactionDate(transactions) ?? to) : to);
    if (transactions.length === 0) return { itemsWritten: 0, note: "no transactions" };
    // A change dated after today (e.g. a future transaction) touches no valued day yet.
    if (from > to) return { itemsWritten: 0, note: `${from} is after ${to}: nothing to value (${event.reason ?? "schedule"})` };

    // Interest periods of corporate bonds (accrued interest).
    const couponPeriods = new Map<string, CouponPeriodItem[]>();
    for (const i of tracked.filter((i) => i.type === "BOND_CORPORATE")) couponPeriods.set(i.isin, await repo.listCouponPeriods(i.isin));

    // Load every price once per instrument for the whole range and walk forward.
    const priceHistory = new Map<string, PriceItem[]>();
    for (const i of tracked) {
      const items = await repo.queryPrices(i.isin, i.venue, "0000-00-00", to);
      priceHistory.set(i.isin, items.sort((a, b) => a.date.localeCompare(b.date)));
    }

    // Exchange rates of the currencies instruments are priced in and money moved in, walked forward the same way;
    // the whole history also goes to the valuation (transactions count at the rate of the day before).
    const currencies = [...new Set([...tracked.map((i) => i.currency), ...transactions.flatMap((t) => [t.currency, t.toCurrency ?? "PLN"])].filter((c) => c && c !== "PLN"))];
    const fxHistory = new Map<string, FxRateItem[]>();
    for (const c of currencies) fxHistory.set(c, (await repo.queryFxRates(c, "0000-00-00", to)).sort((a, b) => a.date.localeCompare(b.date)));

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

    // The positions each day had before: one that's gone now (a transaction edited or deleted) loses its days too,
    // so its row chart doesn't keep stale days.
    // The stored days also tell which come out unchanged: those aren't written again.
    const before = new Map((await repo.querySnapshots(from, to)).map((s) => [s.date, s]));
    let written = 0;
    let unchanged = 0;
    let removed = 0;
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
      const snapshot = valuePortfolio({ date, instruments: tracked, transactions, prices, referenceIndex, couponPeriods, accounts, fx, fxHistory });
      const stored = event.force ? undefined : before.get(date);
      if (!snapshotChanged(stored, snapshot)) {
        if (date === to) await repo.putLatestSnapshot(snapshot);
        unchanged++;
        continue;
      }
      await repo.putSnapshot(snapshot, date === to);
      // Per-position history for the Holdings row charts: only the positions whose day changed.
      await repo.putPositionDays({ date, holdings: changedPositionDays(stored, snapshot) });
      const now = new Set(snapshot.holdings.map((h) => `${h.account}#${h.isin}`));
      const gone = (before.get(date)?.holdings ?? []).filter((h) => !now.has(`${h.account}#${h.isin}`));
      if (gone.length) removed += await repo.deletePositionDays(gone.map((h) => ({ account: h.account, isin: h.isin, date })));
      written++;
    }
    const notes = [unchanged ? `${unchanged} days unchanged` : "", removed ? `${removed} days of positions gone removed` : ""].filter(Boolean);
    return { itemsWritten: written, note: `${from} → ${to} (${event.reason ?? "schedule"})${notes.map((n) => `; ${n}`).join("")}` };
  });
}
