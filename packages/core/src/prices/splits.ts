// Share splits (ETFs). Prices are stored as traded; a split from `date` on turns one unit into `ratio` units.
// Yahoo's history is split-adjusted (and has no split events for some listings), so it's converted back here.

import type { IsoDate } from "../dates.ts";
import type { Split } from "../db/items.ts";

/** Product of the ratios of the splits after `date` (1 when none): a price on `date` ÷ this = today's basis. */
export function splitFactorAfter(splits: Split[] | undefined, date: IsoDate): number {
  return (splits ?? []).filter((s) => s.date > date).reduce((f, s) => f * s.ratio, 1);
}

/** A price series on today's share basis (for charts and changes over time): earlier prices ÷ later splits. */
export function adjustForSplits<T extends { date: IsoDate; close: number }>(prices: T[], splits: Split[] | undefined): T[] {
  if (!splits?.length) return prices;
  return prices.map((p) => {
    const f = splitFactorAfter(splits, p.date);
    return f === 1 ? p : { ...p, close: Number((p.close / f).toFixed(6)) };
  });
}

/**
 * Converts a split-adjusted series (oldest first) back to traded prices: closes before each split × its ratio.
 * Only for splits the series is actually adjusted for: around a split, adjusted closes move as usual, while traded
 * ones drop by about the ratio. Returns the series and the splits it undid.
 */
export function unadjustSplits<T extends { date: IsoDate; close: number }>(closes: T[], splits: Split[] | undefined): { closes: T[]; undone: Split[] } {
  const undone = (splits ?? []).filter((s) => {
    const before = closes.filter((c) => c.date < s.date).at(-1);
    const after = closes.find((c) => c.date >= s.date);
    if (!before || !after) return false;
    const drop = before.close / after.close;
    // Traded series: drop ≈ ratio. Adjusted: drop ≈ 1. Decide by which one it's closer to (log scale).
    return Math.abs(Math.log(drop)) < Math.abs(Math.log(drop / s.ratio));
  });
  if (undone.length === 0) return { closes, undone };
  return {
    closes: closes.map((c) => {
      const f = splitFactorAfter(undone, c.date);
      return f === 1 ? c : { ...c, close: Number((c.close * f).toFixed(4)) };
    }),
    undone,
  };
}
