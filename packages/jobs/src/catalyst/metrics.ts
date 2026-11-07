// The Catalyst metrics (Docs/catalyst.md, "Market metrics"): for the latest session loaded, the State's curves, then
// a screen row per listed bond (core/catalyst/screen.ts) from its last 90 sessions, 30 quotes, terms and interest
// periods. Run by the worker when the daily job, a backfill or a change of assumptions asks for it.

import {
  catalystAssumptions,
  issuerKey,
  fixedCurve,
  recentSessions,
  screenRow,
  wzCurve,
  type CatalystAssumptions,
  type CatalystSessionItem,
  type TreasuryQuote,
} from "@portfolio/core/catalyst/index";
import { Repository, retailOffers, type RetailTerms } from "@portfolio/core";
import { catalystRepo } from "./context.ts";

/** Bonds read at once (each two or three queries). */
const AT_ONCE = 16;
/** Where the assumptions are kept (the module's settings). */
export const ASSUMPTIONS_SETTING = "assumptions";
/** Where the saved views of the screen are kept. */
export const VIEWS_SETTING = "views";

// PT's market table, read-only and only its retail-bond series (infra/catalyst.ts): the alternatives on offer.
const market = new Repository({ market: process.env["MARKET_TABLE"] ?? "", transactions: "", holdings: "" });

/** The retail series on sale on `date` (the alternatives), from PT's market table. */
export function offersOn(date: string): Promise<RetailTerms[]> {
  return retailOffers(date, async (code) => {
    const s = await market.getRetailSeries(code);
    if (!s) return undefined;
    const { PK: _p, SK: _s, source: _src, updatedAt: _u, ...rest } = s;
    return rest;
  });
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function computeMetrics(): Promise<{ itemsWritten: number; note: string; idle?: boolean }> {
  const day = await catalystRepo.latestDay();
  if (!day) return { itemsWritten: 0, idle: true, note: "no session loaded yet" };
  const date = day.date;
  const window = recentSessions(date, 90);
  const from = window.at(-1)!;
  const quotesFrom = window[Math.min(29, window.length - 1)]!;

  const [bonds, terms, saved, exitsNow] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listTerms(), catalystRepo.getSetting<Partial<CatalystAssumptions>>(ASSUMPTIONS_SETTING), catalystRepo.getExitsNow()]);
  const offers = await offersOn(date);
  const { assumptions } = catalystAssumptions(saved, offers);
  const termsBy = new Map(terms.map((t) => [t.isin, t]));
  const listed = bonds.filter((b) => b.status === "listed");

  // Every listed bond's sessions, quotes and interest periods.
  const data = await inBatches(listed, AT_ONCE, async (bond) => {
    const [sessions, quotes, coupons] = await Promise.all([
      catalystRepo.listSessions(bond.isin, from, date),
      catalystRepo.listQuotes(bond.isin, quotesFrom, date),
      termsBy.has(bond.isin) ? catalystRepo.listCoupons(bond.isin) : Promise.resolve([]),
    ]);
    return { bond, sessions, quotes, coupons };
  });

  // The State's curves from the treasury bonds' GPW rows of the session.
  const treasury: TreasuryQuote[] = data.flatMap(({ bond, sessions }) => {
    if (bond.segment !== "treasury" || bond.currency !== "PLN" || !bond.maturity) return [];
    const s = sessions.find((x: CatalystSessionItem) => x.date === date && x.market.startsWith("GPW"));
    return s && s.close !== null && s.nominal ? [{ code: bond.code, maturity: bond.maturity, close: s.close, rate: s.rate, accruedInterest: s.accruedInterest ?? 0, nominal: s.nominal }] : [];
  });
  const fixed = fixedCurve(treasury, date);
  const wz = wzCurve(treasury, date);
  await catalystRepo.putCurve({ date, fixed, wz, computedAt: new Date().toISOString() });

  const rows = data.map(({ bond, sessions, quotes, coupons }) =>
    screenRow({ bond, terms: termsBy.get(bond.isin), coupons, sessions, quotes, fixedCurve: fixed, wzCurve: wz, offers, assumptions }),
  );
  // GPW's measures in force (the exits job): a suspended bond, an issuer marked (bankruptcy, restructuring …).
  const marked = new Set((exitsNow?.marked ?? []).map((m) => issuerKey(m.issuer)));
  for (const row of rows) {
    if (exitsNow?.suspended[row.isin]) row.flags.push("suspended");
    const issuer = termsBy.get(row.isin)?.issuer;
    if (issuer && marked.has(issuerKey(issuer))) row.flags.push("marked");
  }
  const written = await catalystRepo.putScreen(rows);
  const withYield = rows.filter((r) => r.yieldNet !== null).length;
  const withPremium = rows.filter((r) => r.premium !== null).length;
  return {
    itemsWritten: written + 1,
    note: `${date}: ${rows.length} bonds, ${withYield} with a yield, ${withPremium} with a premium; curve of ${fixed.length} fixed and ${wz.length} WZ series; ${offers.length} retail offers`,
  };
}
