// Yahoo Finance chart API (unofficial, no key): daily closes for ETFs. The same endpoint the reference
// sheet falls back to. https://query2.finance.yahoo.com/v8/finance/chart/<symbol>?period1&period2&interval=1d
// `range=max` thins the series to monthly points, so the window is always given as period1/period2.

const BASE = "https://query2.finance.yahoo.com/v8/finance/chart/";
const HEADERS = { "User-Agent": "Mozilla/5.0 (portfolio-tracker, personal use)", Accept: "application/json" };

/** Sheet/Google-style exchange prefixes → Yahoo suffixes (as in the reference sheet's buildYahooSymbol). */
const SUFFIX: Record<string, string> = { WSE: ".WA", LON: ".L", AMS: ".AS", EPA: ".PA", FRA: ".DE", GER: ".DE", ETR: ".DE", SWX: ".SW", BIT: ".MI", NYSE: "", NASDAQ: "" };

/** "AMS:VWRL" → "VWRL.AS"; a plain Yahoo symbol is returned as is. */
export function yahooSymbol(ticker: string): string {
  const [exchange, code] = ticker.trim().toUpperCase().split(":");
  if (!code) return exchange!;
  const suffix = SUFFIX[exchange!];
  if (suffix === undefined) throw new Error(`No Yahoo suffix for exchange ${exchange}`);
  return code + suffix;
}

export interface YahooDaily {
  symbol: string;
  currency: string;
  exchange: string;
  timezone: string;
  /** Oldest first; days without a close are left out. */
  closes: { date: string; close: number }[];
}

interface ChartResponse {
  chart: {
    result?: {
      meta: { symbol: string; currency: string; exchangeName: string; exchangeTimezoneName: string; gmtoffset: number };
      timestamp?: number[];
      indicators: { quote: { close: (number | null)[] }[] };
    }[];
    error?: { code: string; description: string } | null;
  };
}

/** Parses a chart response; dates are the trading day in the exchange's time zone. Prices in GBp become GBP. */
export function parseYahooChart(json: ChartResponse): YahooDaily {
  const r = json.chart.result?.[0];
  if (!r) throw new Error(`Yahoo: ${json.chart.error?.description ?? "empty result"}`);
  const pence = r.meta.currency === "GBp";
  const closes: { date: string; close: number }[] = [];
  (r.timestamp ?? []).forEach((t, i) => {
    const c = r.indicators.quote[0]?.close[i];
    if (c === null || c === undefined) return;
    const date = new Date((t + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10);
    const close = Number((pence ? c / 100 : c).toFixed(4));
    if (closes.at(-1)?.date === date) closes[closes.length - 1] = { date, close };
    else closes.push({ date, close });
  });
  return { symbol: r.meta.symbol, currency: pence ? "GBP" : r.meta.currency, exchange: r.meta.exchangeName, timezone: r.meta.exchangeTimezoneName, closes };
}

/** Daily closes between two ISO dates (inclusive). */
export async function fetchYahooDaily(symbol: string, from: string, to: string): Promise<YahooDaily> {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const url = `${BASE}${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  return parseYahooChart((await res.json()) as ChartResponse);
}
