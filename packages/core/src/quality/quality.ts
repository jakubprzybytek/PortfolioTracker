// Data-quality checks on the prices of what's held (road map 17; the `quality` job, the Status page): trading days
// without a price, a price that stopped coming, day-to-day jumps, and bond prices out of any plausible range. Pure
// functions on one instrument's stored prices; the job runs them daily over the last year of each held instrument.

import { addDays, type IsoDate } from "../dates.ts";
import type { InstrumentItem } from "../db/items.ts";
import { adjustForSplits } from "../prices/splits.ts";
import { easterSunday, isSettlementDay } from "../settlement.ts";

export type QualityKind = "gap" | "stale" | "jump" | "range";

export interface QualityIssue {
  kind: QualityKind;
  isin: string;
  code: string;
  /** The day (jump, range) or the first day (gap, stale). */
  date: IsoDate;
  /** Gap: the last missing day. */
  to?: IsoDate;
  detail: string;
}

/** Venues priced from a source: what can have gaps. Hand-valued (`MANUAL`) and calculated (`CALC`) prices can't. */
export const isQuoted = (i: Pick<InstrumentItem, "venue" | "type">) => i.venue !== "MANUAL" && i.venue !== "CALC" && ["ETF", "BOND_LISTED", "BOND_CORPORATE", "BOND_IBKR"].includes(i.type);

/** Days the Warsaw exchange is closed are known (settlement.ts); elsewhere in the EU the usual exchange holidays. */
function euClosed(date: IsoDate): boolean {
  const year = Number(date.slice(0, 4));
  const easter = easterSunday(year);
  return ["01-01", "05-01", "12-24", "12-25", "12-26", "12-31"].includes(date.slice(5)) || date === addDays(easter, -2) || date === addDays(easter, 1);
}

/** A day the instrument's venue trades. */
export function isTradingDay(venue: string, date: IsoDate): boolean {
  if (venue === "XWAR" || venue === "CATALYST") return isSettlementDay(date);
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !euClosed(date);
}

export interface QualityOptions {
  /** A missing price at the end (up to `lastDay`) is "stale" once this many trading days are missing. */
  staleAfter: number;
  /**
   * Per venue, the shortest run of missing trading days that counts (gap or stale), when not 1 (gap) / `staleAfter`.
   * Catalyst: 10, since a corporate bond that didn't trade has no price that day by design (BiznesRadar's history
   * lists traded sessions only, and the daily snapshot isn't written without a trade).
   */
  minRun: Record<string, number>;
  /** Day-to-day moves above this are jumps: ETFs, bonds. */
  jumpEtf: number;
  jumpBond: number;
  /** Bond clean prices (% of nominal) outside this range are implausible. */
  bondRange: [number, number];
}

export const QUALITY_DEFAULTS: QualityOptions = { staleAfter: 3, minRun: { CATALYST: 10 }, jumpEtf: 0.2, jumpBond: 0.05, bondRange: [50, 150] };

/**
 * One instrument's issues between `from` and `lastDay` (the last day a price should be there by now): runs of
 * trading days without a price (a run reaching `lastDay` is "stale" when long enough, else not yet an issue: the
 * evening's file may come later), jumps between consecutive prices (ETFs after splits), and bond prices out of range.
 */
export function priceIssues(
  inst: Pick<InstrumentItem, "isin" | "code" | "venue" | "type" | "splits">,
  prices: { date: IsoDate; close: number }[],
  from: IsoDate,
  lastDay: IsoDate,
  o: QualityOptions = QUALITY_DEFAULTS,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const base = { isin: inst.isin, code: inst.code };
  const sorted = [...prices].filter((p) => p.date >= from && p.date <= lastDay).sort((a, b) => a.date.localeCompare(b.date));
  const have = new Set(sorted.map((p) => p.date));

  // Gaps: runs of trading days without a price.
  const minRun = o.minRun[inst.venue];
  let run: IsoDate[] = [];
  const flush = (atEnd: boolean) => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run.at(-1)!;
    if (minRun && run.length < minRun) {
      run = [];
      return;
    }
    if (atEnd) {
      if (run.length >= (minRun ?? o.staleAfter)) issues.push({ ...base, kind: "stale", date: first, detail: `no price since ${first} (${run.length} trading days)` });
    } else issues.push({ ...base, kind: "gap", date: first, to: last, detail: run.length === 1 ? `no price on ${first}` : `no price ${first} – ${last} (${run.length} trading days)` });
    run = [];
  };
  for (let d = from; d <= lastDay; d = addDays(d, 1)) {
    if (!isTradingDay(inst.venue, d)) continue;
    if (have.has(d)) flush(false);
    else run.push(d);
  }
  flush(true);

  // Jumps, on prices comparable across splits.
  const etf = inst.type === "ETF";
  const limit = etf ? o.jumpEtf : o.jumpBond;
  const comparable = etf ? adjustForSplits(sorted, inst.splits) : sorted;
  for (let i = 1; i < comparable.length; i++) {
    const a = comparable[i - 1]!;
    const b = comparable[i]!;
    const move = b.close / a.close - 1;
    if (Math.abs(move) > limit) issues.push({ ...base, kind: "jump", date: b.date, detail: `${a.close} on ${a.date} → ${b.close} (${move > 0 ? "+" : "−"}${(Math.abs(move) * 100).toFixed(1)} %)` });
  }

  // Bond prices out of range.
  if (!etf) {
    const [lo, hi] = o.bondRange;
    for (const p of sorted) if (p.close < lo || p.close > hi) issues.push({ ...base, kind: "range", date: p.date, detail: `clean price ${p.close} % on ${p.date}, outside ${lo}–${hi} %` });
  }
  return issues;
}

/** A stable key per issue, to tell new issues from ones already reported. */
export const issueKey = (i: QualityIssue) => `${i.kind}|${i.isin}|${i.date}`;
