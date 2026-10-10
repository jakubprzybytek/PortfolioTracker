// Values the portfolio: one date by default (today), or every day from `from` to `to`.
// Invoked on a schedule, after imports/backfills, or manually with { from, to }.

import {
  addDays,
  firstTransactionDate,
  toReferenceIndex,
  today,
  valuePortfolio,
  type CouponRateItem,
  type IsoDate,
  type PriceItem,
} from "@portfolio/core";
import { repo, runJob } from "../lib/context.ts";

export interface ValuationEvent {
  from?: IsoDate;
  to?: IsoDate;
  reason?: string;
}

export async function handler(event: ValuationEvent = {}) {
  return runJob("valuation", async () => {
    const [instruments, transactions, refIndex] = await Promise.all([repo.listInstruments(), repo.listTransactions(), repo.listReferenceIndex()]);
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

    let written = 0;
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const prices = new Map<string, PriceItem>();
      for (const [isin, items] of priceHistory) {
        let latest: PriceItem | undefined;
        for (const p of items) {
          if (p.date > date) break;
          latest = p;
        }
        if (latest) prices.set(isin, latest);
      }
      const snapshot = valuePortfolio({ date, instruments: tracked, transactions, prices, referenceIndex, couponRates });
      await repo.putSnapshot(snapshot, date === to);
      written++;
    }
    return { itemsWritten: written, note: `${from} → ${to} (${event.reason ?? "schedule"})` };
  });
}
