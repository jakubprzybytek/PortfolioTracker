// Coupon periods of corporate bonds from obligacje.pl: the daily `coupons` job, and the backfill of a new bond.

import { mergePublishedTerms, type InstrumentItem, type IsoDate } from "@portfolio/core";
import { archiveRaw, repo } from "./context.ts";
import { fetchBondPage, parseBondPage } from "./obligacjePl.ts";

/** Corporate bonds the job looks up: those still held (`active`), or every one with `all`. */
export function couponInstruments(instruments: InstrumentItem[], all = false): InstrumentItem[] {
  return instruments.filter((i) => i.type === "BOND_CORPORATE" && i.nominal && (all || i.active));
}

/**
 * Reads the bond's page and merges it into its stored periods (new periods, missing rates; nothing stored is
 * changed). Returns the periods written and the first day whose rate is new.
 */
export async function syncCouponTerms(inst: InstrumentItem, today: IsoDate): Promise<{ written: number; ratesFrom?: IsoDate }> {
  const html = await fetchBondPage(inst.code);
  if (!html) throw new Error(`obligacje.pl has no page for ${inst.code}`);
  await archiveRaw("obligacje-pl", today, `${inst.code}.html`, new TextEncoder().encode(html));
  const bond = parseBondPage(html);
  if (bond.isin !== inst.isin) throw new Error(`obligacje.pl ${inst.code} is ${bond.isin}, not ${inst.isin}`);
  if (bond.nominal !== inst.nominal) throw new Error(`obligacje.pl ${inst.code}: nominal ${bond.nominal}, ours ${inst.nominal}`);
  const stored = await repo.listCouponPeriods(inst.isin);
  const { put, ratesFrom } = mergePublishedTerms(inst.isin, stored.map(({ PK: _p, SK: _s, updatedAt: _u, ...p }) => p), { periods: bond.periods, currentRate: bond.currentRate, fixedRate: bond.fixedRate }, today, new Date().toISOString());
  const written = put.length ? await repo.putCouponPeriods(put) : 0;
  return { written, ...(ratesFrom ? { ratesFrom } : {}) };
}
