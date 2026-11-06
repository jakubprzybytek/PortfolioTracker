// Items of the Catalyst module's own table (`catalyst`, Docs/catalyst.md, "Storage"). The module is separate from the
// portfolio: nothing here refers to transactions or holdings.

import type { IsoDate } from "../dates.ts";
import type { CatalystSegment } from "../gpw/catalystDailyFile.ts";

export type CatalystBondStatus = "listed" | "suspended" | "ended";

/** A bond of the Catalyst market (one per ISIN, whatever the markets it's listed on). */
export interface CatalystBondItem {
  PK: `BOND#${string}`;
  SK: "META";
  GSI1PK: "BOND";
  GSI1SK: string; // code
  isin: string;
  code: string;
  segment: CatalystSegment;
  currency: string;
  /** The markets it's listed on ("GPW RR", "BS ASO" …), from the latest session it appeared in. */
  markets: string[];
  maturity: IsoDate | null;
  /** The nominal per bond in the latest session (instalments and IZ indexation change it). */
  nominal: number | null;
  status: CatalystBondStatus;
  firstSeen: IsoDate;
  lastSeen: IsoDate;
  updatedAt: string;
}

/** One bond on one market in one session (the daily file; bid/ask added from the quotes pages). */
export interface CatalystSessionItem {
  PK: `BOND#${string}`;
  SK: `D#${IsoDate}#${string}`; // D#<date>#<market>
  isin: string;
  date: IsoDate;
  market: string;
  rate: number | null;
  accruedInterest: number | null;
  nominal: number | null;
  close: number | null;
  reference: number | null;
  open: number | null;
  low: number | null;
  high: number | null;
  last: number | null;
  trades: number;
  volume: number;
  turnover: number;
  blockVolume: number;
  blockTurnover: number;
  bid?: { price: number; volume: number; orders: number };
  ask?: { price: number; volume: number; orders: number };
  source: string;
  fetchedAt: string;
}

export const catalystKeys = {
  bond: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "META" as const }),
  session: (isin: string, date: IsoDate, market: string) => ({ PK: `BOND#${isin}` as const, SK: `D#${date}#${market}` as const }),
  day: (date: IsoDate) => ({ PK: "DAYS" as const, SK: date }),
  quoteDay: (date: IsoDate) => ({ PK: "QUOTEDAYS" as const, SK: date }),
  quote: (isin: string, date: IsoDate, market: string) => ({ PK: `BOND#${isin}` as const, SK: `Q#${date}#${market}` as const }),
};

/** A session whose daily file was loaded: the job's look-back skips it, the backfill too. */
export interface CatalystDayItem {
  PK: "DAYS";
  SK: IsoDate;
  date: IsoDate;
  rows: number;
  bonds: number;
  /** The file's name in the archive, e.g. catalyst_20261104.xlsx. */
  file: string;
  fetchedAt: string;
}

/**
 * The order book of one bond on one market at the end of a session (the quotes pages, after the close): the best bid
 * and ask. Its own item, apart from the session (the daily file comes later in the evening). Only rows with a bid or
 * an ask are stored; none for a session means no quotes.
 */
export interface CatalystQuoteItem {
  PK: `BOND#${string}`;
  SK: `Q#${IsoDate}#${string}`; // Q#<date>#<market>
  isin: string;
  date: IsoDate;
  market: string;
  bid?: { price: number; volume: number; orders: number };
  ask?: { price: number; volume: number; orders: number };
  /** The session's trades as the page counted them (the daily file's are the reference). */
  trades: number;
  source: string;
  fetchedAt: string;
}

/** A session whose end-of-day quotes were stored (the morning run only fills a session the evening missed). */
export interface CatalystQuoteDayItem {
  PK: "QUOTEDAYS";
  SK: IsoDate;
  date: IsoDate;
  quotes: number;
  fetchedAt: string;
}
