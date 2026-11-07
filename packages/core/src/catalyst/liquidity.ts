// How easily a Catalyst bond trades (Docs/catalyst.md, "Market metrics"): from its sessions (the daily file) and its
// end-of-session quotes. The level's thresholds are a first guess, to be calibrated on the history (plan, M8).

export type LiquidityLevel = "high" | "medium" | "low" | "none";

export interface Liquidity {
  level: LiquidityLevel;
  /** Share of the last 30 / 90 sessions with a trade. */
  traded30: number;
  traded90: number;
  /** Median turnover of the traded sessions among the last 30 (in the bond's currency); null without any. */
  medianTurnover30: number | null;
  trades30: number;
  /** Median bid–ask spread (percentage points of the price) over the sessions quoted on both sides, last 30. */
  medianSpread30: number | null;
  /** The best bid of the latest quoted session: price (%) and how many bonds. */
  bid: { price: number; volume: number } | null;
  /** Sessions to sell 10 000 at 20% of the average daily turnover (last 30); null when nothing traded. */
  daysToSell10k: number | null;
}

/** One session of the bond's main market (oldest first in the input). */
export interface LiquiditySession {
  trades: number;
  turnover: number;
}

export interface LiquidityQuote {
  bid?: { price: number; volume: number };
  ask?: { price: number };
}

export const HIGH_TRADED_SHARE = 0.8;
export const HIGH_MEDIAN_TURNOVER = 20_000;
export const MEDIUM_TRADED_SHARE = 0.4;
/** The share of a day's turnover one seller can take without moving the price much. */
const PARTICIPATION = 0.2;

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** `sessions`: the main market's, oldest first (up to 90); `quotes`: its end-of-session quotes, oldest first (up to 30). */
export function liquidity(sessions: LiquiditySession[], quotes: LiquidityQuote[]): Liquidity {
  const last30 = sessions.slice(-30);
  const last90 = sessions.slice(-90);
  const share = (xs: LiquiditySession[]) => (xs.length ? round(xs.filter((s) => s.trades > 0).length / xs.length, 4) : 0);
  const traded30 = share(last30);
  const traded90 = share(last90);
  const medianTurnover30 = median(last30.filter((s) => s.trades > 0).map((s) => s.turnover));
  const average = last30.length ? last30.reduce((s, x) => s + x.turnover, 0) / last30.length : 0;
  const spreads = quotes.slice(-30).flatMap((q) => (q.bid && q.ask ? [q.ask.price - q.bid.price] : []));
  const latestBid = [...quotes].reverse().find((q) => q.bid)?.bid;
  const level: LiquidityLevel =
    traded30 === 0 ? "none" : traded30 >= HIGH_TRADED_SHARE && (medianTurnover30 ?? 0) >= HIGH_MEDIAN_TURNOVER ? "high" : traded30 >= MEDIUM_TRADED_SHARE ? "medium" : "low";
  return {
    level,
    traded30,
    traded90,
    medianTurnover30: medianTurnover30 === null ? null : round(medianTurnover30, 2),
    trades30: last30.reduce((s, x) => s + x.trades, 0),
    medianSpread30: spreads.length ? round(median(spreads)!, 4) : null,
    bid: latestBid ? { price: latestBid.price, volume: latestBid.volume } : null,
    daysToSell10k: average > 0 ? Math.ceil(10_000 / (PARTICIPATION * average)) : null,
  };
}
