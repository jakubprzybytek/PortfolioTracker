// Yahoo Finance chart API (unofficial, no key): daily closes for ETFs. The same endpoint the reference
// sheet falls back to. https://query2.finance.yahoo.com/v8/finance/chart/<symbol>?period1&period2&interval=1d
// `range=max` thins the series to monthly points, so the window is always given as period1/period2.
// Symbols come from the instrument's sourceIds.yahoo (see core listingFromTicker).

import { fetchWithTimeout } from "./http.ts";

const BASE = "https://query2.finance.yahoo.com/v8/finance/chart/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (portfolio-tracker, personal use)", Accept: "application/json" };

export interface YahooDaily {
  symbol: string;
  currency: string;
  exchange: string;
  timezone: string;
  /** When the latest price was set (ISO, UTC), if Yahoo says. */
  lastTime?: string;
  /** Oldest first; days without a close are left out. */
  closes: YahooBar[];
}

export interface YahooBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
}

interface ChartResponse {
  chart: {
    result?: {
      meta: { symbol: string; currency: string; exchangeName: string; exchangeTimezoneName: string; gmtoffset: number; regularMarketTime?: number };
      timestamp?: number[];
      indicators: { quote: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: { code: string; description: string } | null;
  };
}

/** Parses a chart response; dates are the trading day in the exchange's time zone. Prices in GBp become GBP. */
export function parseYahooChart(json: ChartResponse): YahooDaily {
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo: ${json.chart.error?.description ?? "empty result"}`);
  const pence = r.meta.currency === "GBp";
  const px = (v: number | null | undefined) => (v === null || v === undefined ? null : Number((pence ? v / 100 : v).toFixed(4)));
  const q = r.indicators.quote[0];
  const closes: YahooBar[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const close = px(q?.close[i]);
    if (close === null) return;
    const date = new Date((t + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10);
    const bar = { date, open: px(q?.open?.[i]), high: px(q?.high?.[i]), low: px(q?.low?.[i]), close, volume: q?.volume?.[i] ?? 0 };
    if (closes.at(-1)?.date === date) closes[closes.length - 1] = bar;
    else closes.push(bar);
  });
  const lastTime = r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : undefined;
  return { symbol: r.meta.symbol, currency: pence ? "GBP" : r.meta.currency, exchange: r.meta.exchangeName, timezone: r.meta.exchangeTimezoneName, ...(lastTime ? { lastTime } : {}), closes };
}

/** Daily closes between two ISO dates (inclusive). */
export async function fetchYahooDaily(symbol: string, from: string, to: string): Promise<YahooDaily> {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const url = `${BASE}${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetchWithTimeout(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  return parseYahooChart((await res.json()) as ChartResponse);
}
