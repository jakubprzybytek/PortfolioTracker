// Returns per calendar year against inflation, and the growth of 100 zł against CPI, for the Dashboard. Pure
// functions on the history points (`total`, `netDeposits` per day) and CPI; light on imports, so the web app can use
// this file directly (`@portfolio/core/valuation/returns`).

import {
  daysBetween,
  daysInMonth,
  shiftMonth,
  type IsoDate,
} from "../dates.ts";
import { dayFactor } from "./history.ts";
import { xirr } from "./xirr.ts";

/** The consumer price level at the end of a month ("YYYY-MM"), on any base; `gus`: from GUS's figure since December (else compounded from the m/m one). */
export interface CpiLevel {
  month: string;
  level: number;
  gus: boolean;
}

/**
 * The price level per month, oldest first, chained from both CPI series: GUS's "December of the previous year = 100"
 * (`ytd`, e.g. 102.4) where it's there, so a calendar year's inflation is exactly GUS's December-on-December figure,
 * and the monthly m/m (`mom`, the IZ reference index's `wr`) where it isn't (compounding the one-decimal m/m figures
 * drifts up to ~0.3 pp a year from GUS's y/y). Starts at 100 the month before the first month known (the December
 * before it when that month has GUS's figure since December); stops at a gap.
 */
export function cpiLevels(
  ytd: { month: string; value: number }[],
  mom: { month: string; wr: number }[],
): CpiLevel[] {
  const byYtd = new Map(ytd.map((m) => [m.month, m.value]));
  const byMom = new Map(mom.map((m) => [m.month, m.wr]));
  const months = [...byYtd.keys(), ...byMom.keys()].sort();
  if (months.length === 0) return [];
  const last = months.at(-1)!;
  const levels = new Map<string, CpiLevel>();
  const base = byYtd.has(months[0]!)
    ? `${Number(months[0]!.slice(0, 4)) - 1}-12`
    : shiftMonth(months[0]!, -1);
  levels.set(base, { month: base, level: 100, gus: true });
  for (let m = months[0]!; m <= last; m = shiftMonth(m, 1)) {
    const december = levels.get(`${Number(m.slice(0, 4)) - 1}-12`);
    const prev = levels.get(shiftMonth(m, -1));
    const y = byYtd.get(m);
    const r = byMom.get(m);
    if (y !== undefined && december)
      levels.set(m, { month: m, level: (december.level * y) / 100, gus: true });
    else if (r !== undefined && prev)
      levels.set(m, { month: m, level: prev.level * (1 + r), gus: false });
    else break;
  }
  return [...levels.values()];
}

/**
 * The price level on a day: a month's level counts at its last day, days in between geometrically. After the last
 * month published it stays flat (`through` says up to which month it's known); before the first, undefined.
 */
export function cpiAt(
  levels: CpiLevel[],
  date: IsoDate,
): { level: number; through: string } | undefined {
  if (levels.length === 0) return undefined;
  const lastKnown = levels.at(-1)!;
  const month = date.slice(0, 7);
  if (month > lastKnown.month)
    return { level: lastKnown.level, through: lastKnown.month };
  const i = levels.findIndex((l) => l.month === month);
  if (i <= 0)
    return month === levels[0]!.month
      ? { level: levels[0]!.level, through: month }
      : undefined;
  const prev = levels[i - 1]!;
  const cur = levels[i]!;
  const days = daysInMonth(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
  );
  const level =
    prev.level * (cur.level / prev.level) ** (Number(date.slice(8, 10)) / days);
  return { level, through: month };
}

/**
 * Every month after the one `cpiAt` starts from at `from` (its month on the last day, else the month before), up to
 * `to`'s, has GUS's figure since December: the change between them is GUS's own, not compounded from m/m.
 */
const cpiExactBetween = (levels: CpiLevel[], from: IsoDate, to: IsoDate) => {
  const lastDay =
    Number(from.slice(8, 10)) ===
    daysInMonth(Number(from.slice(0, 4)), Number(from.slice(5, 7)));
  const a = lastDay ? from.slice(0, 7) : shiftMonth(from.slice(0, 7), -1);
  const b = to.slice(0, 7);
  return levels.filter((l) => l.month > a && l.month <= b).every((l) => l.gus);
};

export interface ReturnPoint {
  date: IsoDate;
  /** Positions + cash. */
  total: number;
  /** Money put in − taken out so far. */
  netDeposits: number;
}

export interface PeriodReturn {
  /** The calendar year, or null for the whole history. */
  year: number | null;
  /** First and last day: the previous year's last point (or the first point ever) and this year's last. */
  from: IsoDate;
  to: IsoDate;
  /** Not a whole calendar year: the first year, or the year so far. */
  partial: boolean;
  startValue: number;
  /** Money put in − taken out during the period. */
  netDeposits: number;
  endValue: number;
  /** endValue − startValue − netDeposits. */
  profit: number;
  /** Time-weighted return over the period (deposits and withdrawals don't count). */
  twr: number | null;
  /** Money-weighted: XIRR of the start value, the period's deposits and withdrawals and the end value; over the period for a partial year, a year for a whole one. */
  xirr: number | null;
  /** CPI over the same days; null without CPI for them. */
  inflation: number | null;
  /** The last month of CPI used (the year so far: CPI is published a month later). */
  cpiThrough: string | null;
  /** All CPI months from GUS's y/y-to-December figure (else partly compounded from the monthly ones: approximate). */
  cpiExact: boolean;
  /** (1 + twr) / (1 + inflation) − 1. */
  real: number | null;
}

/** The whole history: `PeriodReturn` with the rates also as a year (`…PerYear`, geometric) and the XIRR a year. */
export interface TotalReturn extends PeriodReturn {
  years: number;
  twrPerYear: number | null;
  inflationPerYear: number | null;
  realPerYear: number | null;
}

const round = (v: number, dp = 6) => Number(v.toFixed(dp));
const roundPln = (v: number) => Math.round(v * 100) / 100;

function period(
  year: number | null,
  points: ReturnPoint[],
  base: ReturnPoint | undefined,
  levels: CpiLevel[],
  partial: boolean,
): PeriodReturn {
  const first = points[0]!;
  const end = points.at(-1)!;
  const from = base?.date ?? first.date;
  // TWR: each day's factor, chained (the first point ever only starts it: nothing before it to grow).
  let index = 1;
  let prev = base;
  for (const p of points) {
    if (prev) index *= dayFactor(prev, p) ?? 1;
    prev = p;
  }
  const startValue = base?.total ?? 0;
  const startDeposits = base?.netDeposits ?? 0;
  // XIRR: the start value paid in, each day's deposits paid in (withdrawals out), the end value out.
  const flows = [{ date: from, amount: -startValue }];
  let deposits = startDeposits;
  for (const p of points) {
    flows.push({ date: p.date, amount: -(p.netDeposits - deposits) });
    deposits = p.netDeposits;
  }
  flows.push({ date: end.date, amount: end.total });
  const days = daysBetween(from, end.date);
  const annual = xirr(flows);
  const x =
    annual === null
      ? null
      : year !== null && partial
        ? (1 + annual) ** (days / 365) - 1
        : annual;
  const a = cpiAt(levels, from);
  const b = cpiAt(levels, end.date);
  const inflation = a && b && days > 0 ? b.level / a.level - 1 : null;
  const twr = days > 0 ? index - 1 : null;
  return {
    year,
    from,
    to: end.date,
    partial,
    startValue: roundPln(startValue),
    netDeposits: roundPln(end.netDeposits - startDeposits),
    endValue: roundPln(end.total),
    profit: roundPln(
      end.total - startValue - (end.netDeposits - startDeposits),
    ),
    twr: twr === null ? null : round(twr),
    xirr: x === null ? null : round(x),
    inflation: inflation === null ? null : round(inflation),
    cpiThrough: b?.through ?? null,
    cpiExact: inflation !== null && cpiExactBetween(levels, from, end.date),
    real:
      twr === null || inflation === null
        ? null
        : round((1 + twr) / (1 + inflation) - 1),
  };
}

/**
 * Per calendar year (newest first) and over the whole history: value at the start and the end, money put in, profit,
 * the time-weighted return (each day (total − money put in that day) / the day before's total, chained, as the
 * drawdown), the money-weighted one (XIRR), inflation over the same days and the real return. A year runs from the
 * previous year's last point to its own last one; the first year from the first point.
 */
export function yearlyReturns(
  points: ReturnPoint[],
  levels: CpiLevel[],
): { years: PeriodReturn[]; total: TotalReturn | null } {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return { years: [], total: null };
  const byYear = new Map<number, ReturnPoint[]>();
  for (const p of sorted) {
    const y = Number(p.date.slice(0, 4));
    byYear.set(y, [...(byYear.get(y) ?? []), p]);
  }
  const years: PeriodReturn[] = [];
  let base: ReturnPoint | undefined;
  const lastYear = Number(sorted.at(-1)!.date.slice(0, 4));
  for (const [y, ps] of byYear) {
    // Partial: the first year (no point before it), or the year so far.
    years.push(
      period(
        y,
        ps,
        base,
        levels,
        !base || (y === lastYear && ps.at(-1)!.date < `${y}-12-31`),
      ),
    );
    base = ps.at(-1);
  }
  const all = period(null, sorted, undefined, levels, true);
  const span = daysBetween(all.from, all.to) / 365.25;
  const perYear = (v: number | null) =>
    v === null || span < 1 ? null : round((1 + v) ** (1 / span) - 1);
  const total: TotalReturn = {
    ...all,
    years: round(span, 2),
    twrPerYear: perYear(all.twr),
    inflationPerYear: perYear(all.inflation),
    realPerYear: perYear(all.real),
  };
  return { years: years.reverse(), total };
}

/**
 * Growth of 100 zł from the first point given: the portfolio's time-weighted return chained day by day, and what CPI
 * says 100 zł then needs to be to buy as much (null before CPI starts; flat after its last published month).
 */
export function growthOf100(
  points: ReturnPoint[],
  levels: CpiLevel[],
): { date: IsoDate; portfolio: number; cpi: number | null }[] {
  const start = points[0] && cpiAt(levels, points[0].date);
  let index = 100;
  let prev: ReturnPoint | undefined;
  return points.map((p) => {
    if (prev) index *= dayFactor(prev, p) ?? 1;
    prev = p;
    const c = start && cpiAt(levels, p.date);
    return {
      date: p.date,
      portfolio: round(index, 4),
      cpi: c && start ? round((100 * c.level) / start.level, 4) : null,
    };
  });
}
