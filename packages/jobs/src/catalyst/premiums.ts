// The premium history (Docs/catalyst-premium-history-plan.md, step C): the State's curves of every session, each
// bond's premium on the sessions it traded (core/catalyst/screen.ts, sessionPremium: the screen's own), then the
// market index of every session (core/catalyst/premiums.ts). Run by the worker on a `premiums` request; when the
// function's time runs short, the rest goes back on the queue from the last bond done. A run rewrites what it computes,
// so a rule change is a rerun (scripts/catalyst-premiums.ts).

import { fixedCurve, premiumIndex, sessionPremium, wzCurve, type BondPremiums, type CatalystBondItem, type CatalystCurveItem, type CatalystSessionItem, type CatalystTermsItem, type TreasuryQuote } from "@portfolio/core/catalyst/index";
import type { IsoDate } from "@portfolio/core";
import { catalystRepo, queueCatalyst } from "./context.ts";

/** The history starts with the archive (the first daily file loaded). */
const FROM: IsoDate = "2020-01-01";
const TO: IsoDate = "2099-12-31";
/** Bonds read at once (two or three queries each). */
const AT_ONCE = 16;
/** Time kept back to write what's done and queue the rest. */
const RESERVE_MS = 60_000;

/** The bond's main market (its GPW row, as the screen). */
const mainMarket = (b: CatalystBondItem) => b.markets.find((m) => m.startsWith("GPW")) ?? b.markets[0] ?? "";

/** Bonds whose premium means something: not the State's own (theirs is the curve), PLN. */
const wanted = (b: CatalystBondItem) => b.segment !== "treasury" && b.currency === "PLN" && !!b.maturity;

/** The State's curves of every session, from the treasury bonds' GPW rows. */
export async function buildCurves(bonds: CatalystBondItem[]): Promise<{ curves: Map<IsoDate, CatalystCurveItem>; written: number }> {
  const treasury = bonds.filter((b) => b.segment === "treasury" && b.currency === "PLN" && b.maturity && /^(DS|PS|WS|OK|WZ)\d{4}$/.test(b.code));
  const byDate = new Map<IsoDate, TreasuryQuote[]>();
  for (let i = 0; i < treasury.length; i += AT_ONCE) {
    const chunk = treasury.slice(i, i + AT_ONCE);
    const read = await Promise.all(chunk.map(async (b) => ({ b, sessions: await catalystRepo.listSessions(b.isin, FROM, TO) })));
    for (const { b, sessions } of read)
      for (const s of sessions)
        if (s.market.startsWith("GPW") && s.close !== null && s.nominal) {
          const list = byDate.get(s.date) ?? [];
          list.push({ code: b.code, maturity: b.maturity!, close: s.close, rate: s.rate, accruedInterest: s.accruedInterest ?? 0, nominal: s.nominal });
          byDate.set(s.date, list);
        }
  }
  const computedAt = new Date().toISOString();
  const items = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, quotes]) => ({ date, fixed: fixedCurve(quotes, date), wz: wzCurve(quotes, date), computedAt }));
  const written = await catalystRepo.putCurves(items);
  return { curves: new Map(items.map((c) => [c.date, { PK: "CURVE#PLGOV" as const, SK: c.date, ...c }])), written };
}

/** A bond's premium history from its sessions (traded ones on its main market) and the curves of their dates. */
export function bondPremiums(bond: CatalystBondItem, terms: CatalystTermsItem | undefined, coupons: Parameters<typeof sessionPremium>[0]["coupons"], sessions: CatalystSessionItem[], curves: Map<IsoDate, Pick<CatalystCurveItem, "fixed" | "wz">>): BondPremiums | null {
  const market = mainMarket(bond);
  const points: Record<IsoDate, number> = {};
  let basis: BondPremiums["basis"] | undefined;
  for (const s of sessions) {
    if (s.market !== market || s.trades <= 0 || s.close === null) continue;
    const curve = curves.get(s.date);
    if (!curve) continue;
    const p = sessionPremium({ bond, terms, coupons, session: s, fixedCurve: curve.fixed, wzCurve: curve.wz });
    if (!p) continue;
    points[s.date] = p.premium;
    basis = p.basis;
  }
  return basis ? { isin: bond.isin, basis, points } : null;
}

/**
 * One run: the curves (on a fresh start), then the bonds after `after` (by ISIN) while there's time; the index once the
 * last bond is done.
 */
export async function backfillPremiums(after: string | undefined, remainingMs: () => number): Promise<{ itemsWritten: number; note: string }> {
  const [bonds, terms] = await Promise.all([catalystRepo.listBonds(), catalystRepo.listTerms()]);
  const termsBy = new Map(terms.map((t) => [t.isin, t]));
  let written = 0;
  let curves: Map<IsoDate, Pick<CatalystCurveItem, "fixed" | "wz">>;
  let curvesNote = "";
  if (!after) {
    const built = await buildCurves(bonds);
    curves = built.curves;
    written += built.written;
    curvesNote = `${built.written} curves; `;
  } else curves = new Map((await catalystRepo.listCurves(FROM, TO)).map((c) => [c.date, c]));

  const todo = bonds.filter((b) => wanted(b) && (!after || b.isin > after)).sort((a, b) => a.isin.localeCompare(b.isin));
  let withHistory = 0;
  let last = after;
  for (let i = 0; i < todo.length; i += AT_ONCE) {
    if (remainingMs() < RESERVE_MS) {
      await queueCatalyst({ kind: "premiums", ...(last ? { after: last } : {}) });
      return { itemsWritten: written, note: `${curvesNote}${withHistory} bonds with a history; the rest from ${last ?? "the start"} queued again (time)` };
    }
    const chunk = todo.slice(i, i + AT_ONCE);
    const histories = await Promise.all(
      chunk.map(async (b) => {
        const t = termsBy.get(b.isin);
        const [sessions, coupons] = await Promise.all([catalystRepo.listSessions(b.isin, FROM, TO), t && !t.notFound ? catalystRepo.listCoupons(b.isin) : Promise.resolve([])]);
        return bondPremiums(b, t, coupons, sessions, curves);
      }),
    );
    const found = histories.filter((h): h is BondPremiums => h !== null);
    written += await catalystRepo.putPremiums(found);
    withHistory += found.length;
    last = chunk.at(-1)!.isin;
  }

  const index = await buildIndex(bonds);
  written += index.written;
  return { itemsWritten: written, note: `${curvesNote}${withHistory} bonds with a history in this run; ${index.note}` };
}

/**
 * The market index of every session (`dates`: all of them by default) from all bonds' histories: the corporate PLN
 * ones, each with its company's industry.
 */
export async function buildIndex(bonds: CatalystBondItem[], dates?: IsoDate[]): Promise<{ written: number; note: string }> {
  const [histories, links, entities, days] = await Promise.all([catalystRepo.listPremiums(), catalystRepo.listLinks(), catalystRepo.listEntities(), dates ? Promise.resolve(undefined) : catalystRepo.listDays(FROM, TO)]);
  const corporate = new Set(bonds.filter((b) => b.segment === "corporate" && b.currency === "PLN").map((b) => b.isin));
  const industry = new Map(entities.map((e) => [e.entityId, e.industry]));
  const companyOf = new Map(links.filter((l) => l.entityId).map((l) => [l.isin, l.entityId!]));
  const sessions = dates ?? days!.map((d) => d.date);
  const index = premiumIndex(
    sessions,
    histories.filter((h) => corporate.has(h.isin)),
    (isin) => industry.get(companyOf.get(isin) ?? "") ?? undefined,
  );
  // On a day's run only the last session's index is new; the others are there for the 10 sessions it carries.
  const toWrite = dates ? index.slice(-1) : index;
  const written = await catalystRepo.putPremiumIndex(toWrite);
  const byYear = new Map<string, number[]>();
  for (const x of toWrite) if (x.all) byYear.set(x.date.slice(0, 4), [...(byYear.get(x.date.slice(0, 4)) ?? []), x.all.n]);
  const coverage = [...byYear].map(([y, n]) => `${y} ${Math.round(n.reduce((a, b) => a + b, 0) / n.length)}`).join(", ");
  return { written, note: `index of ${toWrite.length} sessions (${toWrite.filter((x) => x.all).length} with a median${coverage ? `; bonds a session on average: ${coverage}` : ""})` };
}
