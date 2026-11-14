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

function stats(values: number[] | undefined, minGroup = MIN_GROUP): IndexStats | undefined {
  if (!values || values.length < minGroup) return undefined;
  const v = [...values].sort((a, b) => a - b);
  return { median: round(quantile(v, 0.5)), q1: round(quantile(v, 0.25)), q3: round(quantile(v, 0.75)), n: v.length };
}

/**
 * The index of each session in `sessions` (ascending): every bond's latest premium within CARRY_SESSIONS sessions
 * (the session itself included), then per group the median and quartiles. `industryOf`: the bond's company's industry
 * (none: only in "all" and its coupon type).
 */
export function premiumIndex(sessions: IsoDate[], bonds: BondPremiums[], industryOf: (isin: string) => string | undefined, minGroup = MIN_GROUP): PremiumIndex[] {
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
      const s = stats(v, minGroup);
      return s ? [[name, s] as const] : [];
    }));
    const all = stats(g.all, minGroup);
    const fixed = stats(g.fixed, minGroup);
    const floating = stats(g.floating, minGroup);
    return { date, ...(all ? { all } : {}), ...(fixed ? { fixed } : {}), ...(floating ? { floating } : {}), industry };
  });
}

/** A session of a bond's premium chart: the bond's own (on a traded session), and what it's compared with. */
export interface PremiumPoint {
  date: IsoDate;
  /** The bond's premium that session; null without a trade. */
  bond: number | null;
  /** The median of the issuer's other bonds (each its latest within CARRY_SESSIONS sessions). */
  issuer?: number;
  /** The bond's industry's median and quartiles. */
  sector?: Omit<IndexStats, "n">;
  /** All corporate bonds' median and quartiles. */
  market?: Omit<IndexStats, "n">;
}

const band = (x: IndexStats | undefined) => (x ? { median: x.median, q1: x.q1, q3: x.q3 } : undefined);

/**
 * The bond's premium chart over `sessions` (ascending): its own premiums, its issuer's other bonds' median (any number
 * of them), its industry's and the market's index.
 */
export function premiumSeries(sessions: IsoDate[], bond: BondPremiums | undefined, others: BondPremiums[], index: PremiumIndex[], industry: string | undefined): PremiumPoint[] {
  const issuer = others.length ? premiumIndex(sessions, others, () => undefined, 1) : [];
  const indexBy = new Map(index.map((x) => [x.date, x]));
  return sessions.map((date, i) => {
    const x = indexBy.get(date);
    const sector = band(industry ? x?.industry[industry] : undefined);
    const market = band(x?.all);
    const own = issuer[i]?.all?.median;
    return { date, bond: bond?.points[date] ?? null, ...(own !== undefined ? { issuer: own } : {}), ...(sector ? { sector } : {}), ...(market ? { market } : {}) };
  });
}

/**
 * What a premium did over the span (last − first, fractions), and the verdict: what moved it. Every change runs over
 * the same sessions: from the bond's first trade in the span to its last (a bond listed in 2023 isn't compared with
 * the market since 2020).
 */
export interface PremiumMoves {
  /** The first and last sessions the changes run between (the bond's first and last trade in the span). */
  from: IsoDate | null;
  to: IsoDate | null;
  bond: number | null;
  issuer: number | null;
  sector: number | null;
  market: number | null;
  /**
   * unchanged: under a quarter point either way; market / sector: the comparison moved about as much; issuer: the
   * issuer's other bonds moved with it, the market didn't; bond: this bond alone (its issuer's others moved less);
   * null: not enough to say (the bond traded fewer than twice in the span).
   */
  verdict: "unchanged" | "market" | "sector" | "issuer" | "bond" | null;
}

/** A move under this (a quarter point) is no move. */
export const NO_MOVE = 0.0025;

const change = (values: (number | undefined | null)[]): number | null => {
  const v = values.filter((x): x is number => x !== undefined && x !== null);
  return v.length >= 2 ? round(v.at(-1)! - v[0]!) : null;
};

export function premiumMoves(all: PremiumPoint[]): PremiumMoves {
  const first = all.findIndex((p) => p.bond !== null);
  const last = all.findLastIndex((p) => p.bond !== null);
  const series = first >= 0 ? all.slice(first, last + 1) : all;
  const bond = change(series.map((p) => p.bond));
  const issuer = change(series.map((p) => p.issuer));
  const sector = change(series.map((p) => p.sector?.median));
  const market = change(series.map((p) => p.market?.median));
  const moves = { from: first >= 0 ? all[first]!.date : null, to: last >= 0 ? all[last]!.date : null, bond, issuer, sector, market };
  if (bond === null) return { ...moves, verdict: null };
  if (Math.abs(bond) < NO_MOVE) return { ...moves, verdict: "unchanged" };
  // The comparison: the bond's sector when it has one, else the market.
  const peers = sector ?? market;
  const own = bond - (peers ?? 0);
  // Most of the move is the peers' (and in its direction).
  if (peers !== null && Math.sign(peers) === Math.sign(bond) && Math.abs(own) < 0.4 * Math.abs(bond)) return { ...moves, verdict: sector !== null ? "sector" : "market" };
  // The rest is the issuer's: its other bonds moved the same way (a third as much will do: a bond near maturity moves
  // several times as much for the same news; GHE0327 +43 pp, Ghelamco's others +21, 2026), or this bond alone.
  if (issuer !== null) {
    const issuerOwn = issuer - (peers ?? 0);
    return { ...moves, verdict: Math.sign(issuerOwn) === Math.sign(own) && Math.abs(issuerOwn) >= Math.abs(own) / 3 ? "issuer" : "bond" };
  }
  return { ...moves, verdict: "issuer" };
}
