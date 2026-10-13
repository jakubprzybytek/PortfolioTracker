// Values the portfolio: one date by default (today), or every day from `from` to `to`.
// Runs only from the FIFO queue (one at a time, in order). A direct invocation (the 22:30/07:30 schedules, or by hand
// with { from, to, reason }) just queues its request, so it can't overlap a run started by an import or backfill.

import {
  addDays,
  firstTransactionDate,
  toReferenceIndex,
  today,
  valuePortfolio,
  type CouponRateItem,
  type FxRateItem,
  type IsoDate,
  type PriceItem,
} from "@portfolio/core";
import type { SQSEvent } from "aws-lambda";
import { queueValuation, repo, runJob } from "../lib/context.ts";

export interface ValuationEvent {
  from?: IsoDate;
  to?: IsoDate;
  reason?: string;
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

    const couponRates = new Map<string, CouponRateItem[]>();
    for (const i of tracked) couponRates.set(i.isin, await repo.listCouponRates(i.isin));

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

    let written = 0;
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
      const snapshot = valuePortfolio({ date, instruments: tracked, transactions, prices, referenceIndex, couponRates, accounts, fx, fxHistory });
      await repo.putSnapshot(snapshot, date === to);
      await repo.putPositionDays(snapshot); // per-position history for the Holdings row charts
      written++;
    }
    return { itemsWritten: written, note: `${from} → ${to} (${event.reason ?? "schedule"})` };
  });
}
