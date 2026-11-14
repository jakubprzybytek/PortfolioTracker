// The premium history (Docs/catalyst-premium-history-plan.md): each bond's premium on the sessions it traded
// (sessionPremium in screen.ts), and per session the market index: the median premium of Catalyst's corporate bonds,
// overall, by coupon type and by industry.

import type { IsoDate } from "../dates.ts";

/** A bond's premium history, as stored (`BOND#<isin>` / `PREMIUMS`): a premium per traded session. */
export interface BondPremiums {
  isin: string;
  basis: "wz" | "fixed-curve";
  /** Session date → premium (fraction), traded sessions only. */
  points: Record<IsoDate, number>;
}

export interface IndexStats {
  median: number;
  /** First and third quartiles. */
  q1: number;
  q3: number;
  /** Bonds in the group that session. */
  n: number;
}

/** The market index of a session (`PREMIUM_INDEX` / `<date>`); a group with fewer than MIN_GROUP bonds is left out. */
export interface PremiumIndex {
  date: IsoDate;
  all?: IndexStats;
  fixed?: IndexStats;
  floating?: IndexStats;
  industry: Record<string, IndexStats>;
}

/** A bond's premium counts for the index this many sessions from its last trade (a thinly traded bond still counts). */
export const CARRY_SESSIONS = 10;
/** Fewer bonds than this in a group that session: no median (a median of 2 jumps with each trade). */
export const MIN_GROUP = 5;

/** The q-th quantile of sorted values, linearly between neighbours. */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;

function stats(values: number[] | undefined): IndexStats | undefined {
  if (!values || values.length < MIN_GROUP) return undefined;
  const v = [...values].sort((a, b) => a - b);
  return { median: round(quantile(v, 0.5)), q1: round(quantile(v, 0.25)), q3: round(quantile(v, 0.75)), n: v.length };
}

/**
 * The index of each session in `sessions` (ascending): every bond's latest premium within CARRY_SESSIONS sessions
 * (the session itself included), then per group the median and quartiles. `industryOf`: the bond's company's industry
 * (none: only in "all" and its coupon type).
 */
export function premiumIndex(sessions: IsoDate[], bonds: BondPremiums[], industryOf: (isin: string) => string | undefined): PremiumIndex[] {
  const at = new Map(sessions.map((d, i) => [d, i]));
  type Groups = { all: number[]; fixed: number[]; floating: number[]; industry: Map<string, number[]> };
  const perSession: Groups[] = sessions.map(() => ({ all: [], fixed: [], floating: [], industry: new Map() }));
  for (const b of bonds) {
    const industry = industryOf(b.isin);
    const points = Object.entries(b.points)
      .map(([d, p]) => [at.get(d), p] as const)
      .filter((x): x is readonly [number, number] => x[0] !== undefined)
      .sort((x, y) => x[0] - y[0]);
    points.forEach(([i, premium], k) => {
      // From this trade until the next one, at most CARRY_SESSIONS sessions.
      const until = Math.min(i + CARRY_SESSIONS, points[k + 1]?.[0] ?? Number.POSITIVE_INFINITY, sessions.length);
      for (let j = i; j < until; j++) {
        const g = perSession[j]!;
        g.all.push(premium);
        (b.basis === "wz" ? g.floating : g.fixed).push(premium);
        if (industry) {
          const list = g.industry.get(industry);
          if (list) list.push(premium);
          else g.industry.set(industry, [premium]);
        }
      }
    });
  }
  return sessions.map((date, i) => {
    const g = perSession[i]!;
    const industry = Object.fromEntries([...g.industry].flatMap(([name, v]) => {
      const s = stats(v);
      return s ? [[name, s] as const] : [];
    }));
    const all = stats(g.all);
    const fixed = stats(g.fixed);
    const floating = stats(g.floating);
    return { date, ...(all ? { all } : {}), ...(fixed ? { fixed } : {}), ...(floating ? { floating } : {}), industry };
  });
}
