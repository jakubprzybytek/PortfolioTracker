// Items of the Catalyst module's own table (`catalyst`, Docs/catalyst.md, "Storage"). The module is separate from the
// portfolio: nothing here refers to transactions or holdings.

import type { IsoDate } from "../dates.ts";
import type { InterestPeriod } from "../bonds/couponPeriods.ts";
import type { CatalystSegment } from "../gpw/catalystDailyFile.ts";
import type { Coupon } from "./terms.ts";
import type { CurvePoint } from "./curve.ts";
import type { ScreenRow } from "./screen.ts";

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
  terms: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "TERMS" as const }),
  coupon: (isin: string, start: IsoDate) => ({ PK: `BOND#${isin}` as const, SK: `COUPON#${start}` as const }),
  quoteDay: (date: IsoDate) => ({ PK: "QUOTEDAYS" as const, SK: date }),
  screen: (isin: string) => ({ PK: `BOND#${isin}` as const, SK: "SCREEN" as const }),
  curve: (date: IsoDate) => ({ PK: "CURVE#PLGOV" as const, SK: date }),
  setting: (name: string) => ({ PK: `SETTING#${name}` as const, SK: "META" as const }),
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

/**
 * A bond's terms from obligacje.pl (the catalyst-terms job), apart from the bond item, which the daily job rewrites.
 * `notFound`: the site has no page for the code (tried again after a month).
 */
export interface CatalystTermsItem {
  PK: `BOND#${string}`;
  SK: "TERMS";
  GSI1PK: "TERMS";
  GSI1SK: string; // isin
  isin: string;
  code: string;
  notFound?: true;
  /** The page's interest periods couldn't be read (its date lists don't add up): kept without them, read again in a month. */
  periodsProblem?: string;
  issuer?: string;
  series?: string;
  /** "Wartość emisji w obrocie": the amount in circulation when read, and the nominal per bond then. */
  issueValue?: { amount: number; currency: string; nominal: number };
  /** "Zabezpieczenie": secured (true), unsecured (false), not said (absent). */
  secured?: boolean;
  /** The coupon as published, and as read (core/catalyst/terms.ts). */
  couponText?: string;
  coupon: Coupon;
  /** The current period's annual rate the site shows. */
  currentRate?: number | null;
  /** First day of the interest period running when read (a floating bond is read again a week into the next one). */
  currentPeriodStart?: IsoDate;
  periods?: number;
  source: string;
  fetchedAt: string;
}

/** One interest period of a bond (dates and rate), as PT's coupon periods (core/bonds/couponPeriods.ts). */
export type CatalystCouponItem = InterestPeriod & { PK: `BOND#${string}`; SK: `COUPON#${IsoDate}`; updatedAt: string };

/** A listed bond's screen row (core/catalyst/screen.ts), recomputed by the metrics; listed on the index as `SCREEN`. */
export type CatalystScreenItem = ScreenRow & { PK: `BOND#${string}`; SK: "SCREEN"; GSI1PK: "SCREEN"; GSI1SK: string; computedAt: string };

/** The State's curves of a session (core/catalyst/curve.ts): fixed-rate yields and WZ price-adjusted margins. */
export interface CatalystCurveItem {
  PK: "CURVE#PLGOV";
  SK: IsoDate;
  date: IsoDate;
  fixed: CurvePoint[];
  wz: CurvePoint[];
  computedAt: string;
}
