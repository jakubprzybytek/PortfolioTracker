// Backfills one instrument's history. Invoked with { isin } by the import Lambda for an instrument
// without a backfill status, or manually (see Docs/backfill.md).

import { Resource } from "sst";
import { queueValuation, repo, runJob } from "../lib/context.ts";
import { interpolatePricePath, isTradingDay, today, type PriceItem } from "@portfolio/core";
import { BIZNESRADAR_SOURCE_ID, backfillBiznesradarHistory } from "../lib/catalystJobs.ts";
import { syncCouponTerms } from "../lib/couponJobs.ts";
import { YAHOO_SOURCE_ID, backfillYahooHistory } from "../lib/etfJobs.ts";
import { GPW_SOURCE_ID, backfillGpwHistory } from "../lib/gpwJobs.ts";
import { IBKR_SOURCE_ID, backfillIbkrHistory } from "../lib/ibkrJobs.ts";
import { ONVISTA_SOURCE_ID, backfillOnvistaHistory, fillEtfGapsFromOnvista } from "../lib/onvistaJobs.ts";

export interface BackfillEvent {
  isin: string;
  /** Re-run the valuation afterwards (default true). */
  revalue?: boolean;
  /**
   * Instead of the whole history: fill only the days in [from, to] without a price, from a second source (ETFs:
   * onvista's closes on the same exchange). For gaps the `quality` job reports (Yahoo holes); never overwrites.
   */
  fillGaps?: { source: "onvista"; from: string; to: string };
}

export async function backfillInstrument(isin: string): Promise<{ status: string; rows?: number; from?: string; to?: string }> {
  const inst = await repo.getInstrument(isin);
  if (!inst) throw new Error(`Unknown instrument ${isin}`);

  if (inst.sourceIds[GPW_SOURCE_ID]) {
    await repo.putBackfillStatus({ isin, status: "running", source: GPW_SOURCE_ID });
    try {
      const result = await backfillGpwHistory(inst);
      await repo.putBackfillStatus({ isin, status: "done", source: GPW_SOURCE_ID, ...result });
      return { status: "done", ...result };
    } catch (err) {
      await repo.putBackfillStatus({ isin, status: "failed", source: GPW_SOURCE_ID, note: String((err as Error).message) });
      throw err;
    }
  }

  if (inst.sourceIds[YAHOO_SOURCE_ID]) {
    await repo.putBackfillStatus({ isin, status: "running", source: YAHOO_SOURCE_ID });
    try {
      const result = await backfillYahooHistory(inst);
      await repo.putBackfillStatus({ isin, status: "done", source: YAHOO_SOURCE_ID, ...result });
      return { status: "done", ...result };
    } catch (err) {
      await repo.putBackfillStatus({ isin, status: "failed", source: YAHOO_SOURCE_ID, note: String((err as Error).message) });
      throw err;
    }
  }

  if (inst.sourceIds[BIZNESRADAR_SOURCE_ID]) {
    await repo.putBackfillStatus({ isin, status: "running", source: BIZNESRADAR_SOURCE_ID });
    try {
      const result = await backfillBiznesradarHistory(inst, today());
      await repo.putBackfillStatus({ isin, status: "done", source: BIZNESRADAR_SOURCE_ID, ...result });
      // Its coupon periods too (the valuation that follows uses them); the daily job retries if this fails.
      if (inst.type === "BOND_CORPORATE")
        await syncCouponTerms(inst, today()).catch((err) => console.error(`coupon periods of ${inst.code}:`, err));
      return { status: "done", ...result };
    } catch (err) {
      await repo.putBackfillStatus({ isin, status: "failed", source: BIZNESRADAR_SOURCE_ID, note: String((err as Error).message) });
      throw err;
    }
  }

  // IBKR's mark prices (US T-bills): from the first trade, the trade day at its price (IBKR reports from settlement).
  if (inst.sourceIds[IBKR_SOURCE_ID]) {
    await repo.putBackfillStatus({ isin, status: "running", source: IBKR_SOURCE_ID });
    try {
      const result = await backfillIbkrHistory(inst, today());
      await repo.putBackfillStatus({ isin, status: "done", source: IBKR_SOURCE_ID, ...result });
      return { status: "done", ...result };
    } catch (err) {
      await repo.putBackfillStatus({ isin, status: "failed", source: IBKR_SOURCE_ID, note: String((err as Error).message) });
      throw err;
    }
  }

  if (inst.sourceIds[ONVISTA_SOURCE_ID]) {
    await repo.putBackfillStatus({ isin, status: "running", source: ONVISTA_SOURCE_ID });
    try {
      const result = await backfillOnvistaHistory(inst, today());
      await repo.putBackfillStatus({ isin, status: "done", source: ONVISTA_SOURCE_ID, ...result });
      return { status: "done", ...result };
    } catch (err) {
      await repo.putBackfillStatus({ isin, status: "failed", source: ONVISTA_SOURCE_ID, note: String((err as Error).message) });
      throw err;
    }
  }

  // Calculated prices (foreign bonds at IBKR without a quote: bills, matured bonds): the whole path from the first trade to maturity, at once.
  if (inst.pricePath?.length) {
    const fetchedAt = new Date().toISOString();
    const items = interpolatePricePath(inst.pricePath).map(
      (p): PriceItem => ({
        PK: `INST#${isin}`,
        SK: `PX#${inst.venue}#${p.date}`,
        isin,
        venue: inst.venue,
        date: p.date,
        open: null,
        high: null,
        low: null,
        close: p.price,
        volume: 0,
        trades: 0,
        turnover: 0,
        traded: true,
        currency: inst.currency,
        source: "calculated",
        fetchedAt,
        status: "final",
      }),
    );
    const rows = await repo.putPrices(items);
    const result = { from: items[0]!.date, to: items.at(-1)!.date, rows, note: "calculated: constant yield between your trades and redemption" };
    await repo.putBackfillStatus({ isin, status: "done", source: "calculated", ...result });
    return { status: "done", ...result };
  }

  // No source can provide history for this instrument (e.g. Catalyst corporate bonds): say so.
  await repo.putBackfillStatus({ isin, status: "no_history", note: "No history source for this instrument; daily collection only" });
  return { status: "no_history" };
}

export async function handler(event: BackfillEvent) {
  const isins = [event.isin];
  const revalue = event.revalue ?? true;
  if (event.fillGaps) {
    const { from, to } = event.fillGaps;
    return runJob("backfill", async () => {
      const inst = await repo.getInstrument(event.isin);
      if (!inst) throw new Error(`Unknown instrument ${event.isin}`);
      if (inst.type !== "ETF") throw new Error(`${inst.code}: filling gaps from onvista is for ETFs`);
      const r = await fillEtfGapsFromOnvista(inst, from, to, (d) => isTradingDay(inst.venue, d));
      if (revalue && r.rows > 0) await queueValuation({ reason: "gaps filled", from: r.dates[0] });
      return { itemsWritten: r.rows, note: `${inst.code}: ${r.rows} missing days filled from onvista${r.dates.length ? ` (${r.dates[0]} – ${r.dates.at(-1)})` : ""}` };
    });
  }
  return runJob("backfill", async () => {
    const results: Record<string, unknown> = {};
    let itemsWritten = 0;
    for (const isin of isins) {
      const r = await backfillInstrument(isin);
      results[isin] = r;
      itemsWritten += r.rows ?? 0;
    }
    if (revalue && itemsWritten > 0) await queueValuation({ reason: "backfill", isins });
    return { itemsWritten, note: JSON.stringify(results) };
  });
}
