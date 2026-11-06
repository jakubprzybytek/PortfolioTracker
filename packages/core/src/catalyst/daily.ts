// What a daily statistics file (core/gpw/catalystDailyFile.ts) changes in the Catalyst table: a session per bond and
// market, the bonds (new ones, their current nominal, maturity and markets), and, for the latest session, the bonds
// that left the market. Pure: the job reads the stored bonds, this decides, the job writes.

import { addDays, type IsoDate } from "../dates.ts";
import type { CatalystDailyFile, CatalystFileRow } from "../gpw/catalystDailyFile.ts";
import { isSettlementDay } from "../settlement.ts";
import type { CatalystBondItem, CatalystSessionItem } from "./items.ts";

export const DAILY_FILE_SOURCE = "gpwcatalyst-daily";

export type BondFields = Omit<CatalystBondItem, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "updatedAt">;
export type SessionFields = Omit<CatalystSessionItem, "PK" | "SK">;

export interface DailyPlan {
  sessions: SessionFields[];
  /** Bonds to write: new ones, and stored ones the file changes. */
  bonds: BondFields[];
  /** Of `bonds`, those seen for the first time. */
  added: string[];
  /** Of `bonds`, the listed ones absent from the latest session (now `ended`). */
  ended: string[];
}

/** The GPW row of a bond when it has one (BondSpot rows of treasury bonds carry stale prices), else the first. */
function mainRow(rows: CatalystFileRow[]): CatalystFileRow {
  return rows.find((r) => r.market.startsWith("GPW")) ?? rows[0]!;
}

/**
 * The writes for one file. `stored`: the bonds in the table, by ISIN. `latest`: the file is the newest session
 * stored (the daily job), so listed bonds missing from it have ended; a backfill of older days passes false and only
 * widens the bonds' first and last sessions.
 */
export function planDailyFile(file: CatalystDailyFile, stored: Map<string, CatalystBondItem>, fetchedAt: string, latest: boolean): DailyPlan {
  const byIsin = new Map<string, CatalystFileRow[]>();
  for (const r of file.rows) byIsin.set(r.isin, [...(byIsin.get(r.isin) ?? []), r]);

  const sessions: SessionFields[] = file.rows.map((r) => ({
    isin: r.isin,
    date: file.date,
    market: r.market,
    rate: r.rate,
    accruedInterest: r.accruedInterest,
    nominal: r.nominal,
    close: r.close,
    reference: r.reference,
    open: r.open,
    low: r.low,
    high: r.high,
    last: r.last,
    trades: r.trades,
    volume: r.volume,
    turnover: r.turnover,
    blockVolume: r.blockVolume,
    blockTurnover: r.blockTurnover,
    source: DAILY_FILE_SOURCE,
    fetchedAt,
  }));

  const bonds: BondFields[] = [];
  const added: string[] = [];
  for (const [isin, rows] of byIsin) {
    const main = mainRow(rows);
    const now: Omit<BondFields, "firstSeen" | "lastSeen" | "status"> = {
      isin,
      code: main.code,
      segment: main.segment,
      currency: main.currency,
      markets: [...new Set(rows.map((r) => r.market))].sort(),
      maturity: main.maturity,
      nominal: main.nominal,
    };
    const old = stored.get(isin);
    if (!old) {
      bonds.push({ ...now, status: "listed", firstSeen: file.date, lastSeen: file.date });
      added.push(isin);
      continue;
    }
    // The file's fields win when it's at least as new as what's stored; an older one only widens the span.
    const newer = file.date >= old.lastSeen;
    const next: BondFields = {
      ...(newer ? now : { isin, code: old.code, segment: old.segment, currency: old.currency, markets: old.markets, maturity: old.maturity, nominal: old.nominal }),
      status: newer ? "listed" : old.status,
      firstSeen: file.date < old.firstSeen ? file.date : old.firstSeen,
      lastSeen: newer ? file.date : old.lastSeen,
    };
    if (!sameBond(old, next)) bonds.push(next);
  }

  const ended: string[] = [];
  if (latest)
    for (const old of stored.values())
      if (old.status === "listed" && !byIsin.has(old.isin) && old.lastSeen < file.date) {
        bonds.push({ ...withoutKeys(old), status: "ended" });
        ended.push(old.isin);
      }

  return { sessions, bonds, added, ended };
}

function withoutKeys(b: CatalystBondItem): BondFields {
  const { PK: _pk, SK: _sk, GSI1PK: _g, GSI1SK: _gs, updatedAt: _u, ...rest } = b;
  return rest;
}

function sameBond(a: CatalystBondItem, b: BondFields): boolean {
  return (
    a.code === b.code &&
    a.segment === b.segment &&
    a.currency === b.currency &&
    a.markets.join() === b.markets.join() &&
    a.maturity === b.maturity &&
    a.nominal === b.nominal &&
    a.status === b.status &&
    a.firstSeen === b.firstSeen &&
    a.lastSeen === b.lastSeen
  );
}

/** The trading sessions from `today` back, newest first: `count` of them (today counts when it's a trading day). */
export function recentSessions(today: IsoDate, count: number): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = today; out.length < count; d = addDays(d, -1)) if (isSettlementDay(d)) out.push(d);
  return out;
}
