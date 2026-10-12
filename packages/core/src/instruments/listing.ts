// Exchange listings of ETFs: the reference sheet's Google-style tickers ("AMS:VWRL") → our venue (MIC) and the
// Yahoo symbol the daily job fetches. FRA in the sheet means the German listing, priced from Xetra.

const LISTINGS: Record<string, { venue: string; yahooSuffix: string }> = {
  AMS: { venue: "XAMS", yahooSuffix: ".AS" },
  FRA: { venue: "XETR", yahooSuffix: ".DE" },
  ETR: { venue: "XETR", yahooSuffix: ".DE" },
  GER: { venue: "XETR", yahooSuffix: ".DE" },
  LON: { venue: "XLON", yahooSuffix: ".L" },
  EPA: { venue: "XPAR", yahooSuffix: ".PA" },
  BIT: { venue: "XMIL", yahooSuffix: ".MI" },
  SWX: { venue: "XSWX", yahooSuffix: ".SW" },
  WSE: { venue: "XWAR", yahooSuffix: ".WA" },
};

export interface Listing {
  code: string;
  venue: string;
  yahoo: string;
}

/** "AMS:VWRL" → { code: "VWRL", venue: "XAMS", yahoo: "VWRL.AS" }; undefined for an unknown exchange or no prefix. */
export function listingFromTicker(ticker: string): Listing | undefined {
  const [exchange, code] = ticker.trim().toUpperCase().split(":");
  const l = code ? LISTINGS[exchange!] : undefined;
  return l && code ? { code, venue: l.venue, yahoo: code + l.yahooSuffix } : undefined;
}
