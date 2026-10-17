// Pure functions for the Dashboard's history charts; no AWS imports, so the web app can import this file directly
// (`@portfolio/core/valuation/history`).
import { addDays } from "../dates.ts";
import type { HistoryPointItem, HoldingSnapshot, SnapshotItem } from "../db/items.ts";

/** The big picture's asset classes, in display order. */
export const ASSET_CLASSES = ["SHARES", "BONDS", "CASH", "OTHER"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

const CLASS_OF_TYPE: Record<string, AssetClass> = {
  ETF: "SHARES",
  BOND_LISTED: "BONDS",
  BOND_CORPORATE: "BONDS",
  BOND_RETAIL: "BONDS",
  BOND_IBKR: "BONDS",
  CURRENCY: "CASH",
  CASH: "CASH",
  FUND_MANUAL: "OTHER",
};

/** An ETF holding bonds ("… Corporate Bond UCITS ETF") counts as bonds; other ETFs as shares. */
export const assetClassOf = (h: Pick<HoldingSnapshot, "type" | "name">): AssetClass => (h.type === "ETF" && /\bbond/i.test(h.name) ? "BONDS" : (CLASS_OF_TYPE[h.type] ?? "OTHER"));

/** One day's value per asset class: positions of every account plus the cash of the fully tracked ones (as the totals). */
export function valueByClass(snapshot: Pick<SnapshotItem, "holdings" | "totals">): Record<AssetClass, number> {
  const out: Record<AssetClass, number> = { SHARES: 0, BONDS: 0, CASH: 0, OTHER: 0 };
  for (const h of snapshot.holdings) if (h.value) out[assetClassOf(h)] += h.value;
  out.CASH += snapshot.totals.cash ?? 0;
  for (const k of ASSET_CLASSES) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/** The day's chart point: what the history charts use of a snapshot (written by the valuation next to it). */
export function historyPointOf(snapshot: Pick<SnapshotItem, "date" | "holdings" | "totals" | "byType">): Omit<HistoryPointItem, "PK" | "SK"> {
  return { date: snapshot.date, totals: snapshot.totals, byType: snapshot.byType, byClass: valueByClass(snapshot) };
}

/**
 * Drawdown per day: how far the portfolio is below its best so far, as a fraction (0 at a new high, −0.12 = 12 % below).
 * Measured on the time-weighted return, not on the value itself, so money put in or taken out (the change of
 * `netDeposits`) is neither a gain nor a loss: a withdrawal isn't a drawdown. A day's return is
 * (total − money added that day) / the day before's total. The best so far counts from the first point given.
 */
export function drawdowns(points: { date: string; total: number; netDeposits: number }[]): { date: string; drawdown: number }[] {
  let index = 1;
  let peak = 1;
  let prev: (typeof points)[number] | undefined;
  return points.map((p) => {
    if (prev && prev.total > 0) {
      const r = (p.total - (p.netDeposits - prev.netDeposits)) / prev.total;
      if (Number.isFinite(r) && r > 0) index *= r;
    }
    prev = p;
    peak = Math.max(peak, index);
    return { date: p.date, drawdown: Math.round((index / peak - 1) * 1e6) / 1e6 };
  });
}

/**
 * A position's daily points (oldest first) with the days it wasn't held filled in as zero, so the chart drops to 0 for
 * that time (as wide as it lasted: the chart spaces its points evenly) instead of drawing a line across (e.g. money
 * moved out of a fund category and back years later).
 */
export function withZeroGaps<P extends { date: string; value: number; cost: number; quantity: number }>(points: P[]): { date: string; value: number; cost: number; quantity: number }[] {
  const out: { date: string; value: number; cost: number; quantity: number }[] = [];
  for (const p of points) {
    const prev = out.at(-1);
    if (prev) for (let d = addDays(prev.date, 1); d < p.date; d = addDays(d, 1)) out.push({ date: d, value: 0, cost: 0, quantity: 0 });
    out.push(p);
  }
  return out;
}
