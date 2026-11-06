// What the quotes pages (core/gpw/catalystQuotes.ts) give the Catalyst table: the end-of-session order book of each
// bond with a bid or an ask. The page has no date: it shows the session under way or the last one.

import { addDays, type IsoDate } from "../dates.ts";
import type { CatalystQuote } from "../gpw/catalystQuotes.ts";
import { isSettlementDay } from "../settlement.ts";
import type { CatalystQuoteItem } from "./items.ts";

export const QUOTES_SOURCE = "gpwcatalyst-quotes";

/** Sessions open at 09:00 Warsaw time: before that, the pages still show the previous one. */
const SESSION_OPENS = "09:00";

const WARSAW_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const WARSAW_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });

/** The session the pages show at `now`: today's once it has opened on a trading day, else the trading day before. */
export function quotesSession(now: Date): IsoDate {
  const day = WARSAW_DAY.format(now);
  if (isSettlementDay(day) && WARSAW_TIME.format(now) >= SESSION_OPENS) return day;
  let d = addDays(day, -1);
  while (!isSettlementDay(d)) d = addDays(d, -1);
  return d;
}

export type QuoteFields = Omit<CatalystQuoteItem, "PK" | "SK">;

/**
 * The quotes to store for `date`: rows with a bid or an ask whose code is a known bond (`isinByCode`). Returns the
 * codes the table doesn't know (a bond listed since the last daily file) apart.
 */
export function planQuotes(quotes: CatalystQuote[], isinByCode: Map<string, string>, date: IsoDate, fetchedAt: string): { quotes: QuoteFields[]; unknown: string[] } {
  const out: QuoteFields[] = [];
  const unknown = new Set<string>();
  for (const q of quotes) {
    if (!q.bid && !q.ask) continue;
    const isin = isinByCode.get(q.code);
    if (!isin) {
      unknown.add(q.code);
      continue;
    }
    out.push({ isin, date, market: q.market, ...(q.bid ? { bid: q.bid } : {}), ...(q.ask ? { ask: q.ask } : {}), trades: q.trades, source: QUOTES_SOURCE, fetchedAt });
  }
  return { quotes: out, unknown: [...unknown].sort() };
}
