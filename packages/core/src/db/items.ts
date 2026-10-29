// Item shapes and key builders for the DynamoDB tables market, transactions and holdings (see Docs/data-storage.md).

import type { IsoDate } from "../dates.ts";
import type { BondTerms } from "../bonds/terms.ts";
import type { RetailTerms } from "../mf/retailRates.ts";
import type { AssetClass } from "../valuation/history.ts";

export type InstrumentType = "BOND_LISTED" | "BOND_CORPORATE" | "BOND_RETAIL" | "ETF" | "BOND_IBKR" | "FUND_MANUAL" | "CURRENCY" | "CASH";

export interface InstrumentItem {
  PK: `INST#${string}`;
  SK: "META";
  GSI1PK: "INSTRUMENT";
  GSI1SK: string; // isin
  isin: string;
  code: string; // exchange code, e.g. DS0432
  name: string;
  type: InstrumentType;
  currency: string;
  venue: string; // XWAR, CATALYST, CALC, MANUAL …
  sourceIds: Record<string, string>; // { gpw: "DS0432" }
  active: boolean;
  terms?: BondTerms;
  /** Bonds without terms (corporate bonds): nominal per bond; prices are % of it, value = clean price × nominal. */
  nominal?: number;
  /** Retail treasury bonds: the series' terms and published rates (from the Ministry file). */
  retail?: RetailTerms;
  /**
   * Prices without a market source (foreign government bonds at IBKR): known points (your trades, and redemption at
   * maturity), % of nominal. Daily prices in between are interpolated at a constant yield and stored as PX#CALC.
   */
  pricePath?: { date: IsoDate; price: number }[];
  /** Share splits: from `date` on, one unit became `ratio` units (prices stored as traded, not adjusted). */
  splits?: Split[];
  /** Asset class set by hand, when it differs from the rule (`assetClassOf`: by type, an ETF with "bond" in its name = bonds). */
  assetClass?: AssetClass;
  updatedAt: string;
}

export interface Split {
  date: IsoDate;
  ratio: number;
}

/** One retail series from the Ministry file ("Dane dotyczące obligacji detalicznych"). */
export interface RetailSeriesItem extends RetailTerms {
  PK: `SERIES#${string}`;
  SK: "META";
  source: string;
  updatedAt: string;
}

export type PriceStatus = "provisional" | "final";

export interface PriceItem {
  PK: `INST#${string}`;
  SK: `PX#${string}#${IsoDate}`;
  isin: string;
  venue: string;
  date: IsoDate;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number; // bonds: clean price in % of nominal
  volume: number;
  trades: number;
  turnover: number;
  traded: boolean;
  lastTradeDate?: IsoDate;
  /** A price fetched during the day ("Refresh prices"): when the source set it (ISO). The day's close drops it. */
  quoteTime?: string;
  currency: string;
  source: string;
  fetchedAt: string;
  status: PriceStatus;
  flags?: string[];
}

export interface ReferenceIndexItem {
  PK: "CPI_REF";
  SK: string; // "YYYY-MM"
  month: string;
  wr: number;
  w: number;
  source: string;
  updatedAt: string;
}

/**
 * GUS CPI per month as GUS publishes it (e.g. 102.4), one series per base: `CPI_YTD` December of the previous year = 100
 * (prices since the year began; December's is the year's inflation), `CPI_YOY` the same month of the previous year = 100
 * (12-month inflation).
 */
export type GusCpiSeries = "CPI_YTD" | "CPI_YOY";
export interface GusCpiItem {
  PK: GusCpiSeries;
  SK: string; // "YYYY-MM"
  month: string;
  value: number;
  source: string;
  updatedAt: string;
}

/** NBP table A mid rate: PLN per unit of `currency` on `date` (business days only). */
export interface FxRateItem {
  PK: `FX#${string}`;
  SK: IsoDate;
  currency: string;
  date: IsoDate;
  mid: number;
  /** NBP table number, e.g. "198/A/NBP/2026". */
  table: string;
  source: string;
}

/** The latest data-quality report (`quality` job, core/quality/quality.ts): one item, rewritten by each run. */
export interface QualityReportItem {
  PK: "QUALITY";
  SK: "LATEST";
  checkedAt: string;
  /** Held instruments with quoted prices that were checked, and the period: the last year up to `lastDay`. */
  instruments: number;
  from: IsoDate;
  lastDay: IsoDate;
  issues: import("../quality/quality.ts").QualityIssue[];
}

/** A benchmark's close on `date`, in its own currency (`core/benchmarks/benchmarks.ts`, the `benchmarks` job). */
export interface BenchmarkPriceItem {
  PK: `BENCH#${string}`;
  SK: IsoDate;
  id: string;
  date: IsoDate;
  close: number;
  currency: string;
  source: string;
  fetchedAt: string;
}

/** Who set a coupon period's rate or dates: you (the app), obligacje.pl (the `coupons` job), or your coupons received. */
export type CouponSource = "manual" | "obligacje.pl" | "coupons";

/**
 * One interest period of a corporate bond (floating or fixed coupon): its dates (as on obligacje.pl, or entered by
 * hand) and its annual rate. A period without a rate gives no accrued interest (the bond is valued at the clean price).
 */
export interface CouponPeriodItem {
  PK: `INST#${string}`;
  SK: `COUPON#${IsoDate}`;
  isin: string;
  /** First day of the period. */
  start: IsoDate;
  /** Exclusive: the next period's first day. */
  end: IsoDate;
  /** Who holds the bond at the end of this day gets the coupon. */
  recordDate?: IsoDate;
  paymentDate: IsoDate;
  datesSource: CouponSource;
  /** Annual rate, e.g. 0.0713. */
  rate?: number;
  rateSource?: CouponSource;
  /** obligacje.pl showed another rate for this period than the one stored: kept for you to decide, not used. */
  otherRate?: { rate: number; source: CouponSource; seenAt: string };
  updatedAt: string;
}

/** Account metadata. */
export interface AccountItem {
  PK: `ACCT#${string}`;
  SK: "META";
  GSI1PK: "ACCOUNT";
  GSI1SK: string; // account
  account: string;
  /** The account's own currency (IBKR: EUR): its summary is also shown in it. Absent: PLN. */
  baseCurrency?: string;
  updatedAt: string;
}

export type TransactionType =
  | "BUY"
  | "SELL"
  | "COUPON"
  | "REDEMPTION"
  /** Bonds (or units) lost: the issuer defaulted, nothing came back. Closes `quantity` at 0 (`amount` 0); money recovered later is its own row. */
  | "WRITE_OFF"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "TAX"
  | "INTEREST"
  | "DIVIDEND"
  | "SPLIT"
  /** Currency conversion in an account: `amount` (negative) in `currency` out, `toAmount` in `toCurrency` in. */
  | "EXCHANGE";

export interface TransactionItem {
  PK: `ACCT#${string}`;
  SK: `TX#${IsoDate}#${string}`;
  GSI1PK: "TX";
  GSI1SK: `${IsoDate}#${string}`;
  id: string;
  account: string;
  date: IsoDate;
  type: TransactionType;
  isin?: string;
  quantity?: number;
  price?: number; // bonds: clean % of nominal; retail bonds: PLN per 100 PLN bond; ETFs: in the instrument's currency
  /** Paid in PLN for an instrument in another currency (Bossa): PLN per unit of the instrument's currency. */
  fxRate?: number;
  /** EXCHANGE: what came in, in `toCurrency`. */
  toAmount?: number;
  toCurrency?: string;
  /** SPLIT: each unit held becomes `ratio` units. */
  ratio?: number;
  /** Retail bonds: when interest starts (the purchase date), if not the transaction date. */
  valueDate?: IsoDate;
  amount: number; // signed cash effect in `currency`: negative = money out
  fee?: number; // in `currency`
  /** Currency of `amount` and `fee`: what was actually paid or received (PLN, EUR, USD …). */
  currency: string;
  note?: string;
  source: string;
}

/** A note (Notes view): Markdown text with a title. Transactions table, as it's your input. */
export interface NoteItem {
  PK: `NOTE#${string}`;
  SK: "META";
  GSI1PK: "NOTE";
  GSI1SK: string; // id
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** One position: an instrument held in one account. */
export interface HoldingSnapshot {
  account: string;
  isin: string;
  code: string;
  name: string;
  type: InstrumentType;
  currency: string;
  quantity: number;
  cleanPrice: number | null;
  priceDate: IsoDate | null;
  /** The price was fetched during the day ("Refresh prices"): when the source set it (ISO). */
  priceTime?: string;
  nominal: number | null;
  accruedInterest: number | null;
  valuePerUnit: number | null;
  value: number | null;
  cost: number;
  couponsReceived: number;
  gain: number | null;
  gainPct: number | null;
  flags: string[];
  /** Retail and corporate bonds: annual rate of the current period and of the one before (null in the first). */
  rate?: { current: number; previous: number | null };
  /** Corporate bonds valued at the clean price only: the first day of the period without a rate (null: no periods). */
  noCouponRate?: { from: IsoDate | null };
  /** Foreign-currency instruments: the NBP mid rate used (PLN per unit of `currency`) and its date. */
  fx?: { rate: number; date: IsoDate };
  /** Bought in another currency than PLN: the cost in that currency (gain there = value at today's price − this). */
  costNative?: { amount: number; currency: string };
  /** The instrument's asset class set by hand (none: the rule, `assetClassOf`). */
  assetClass?: AssetClass;
}

/** An account's cash. */
export interface AccountSnapshot {
  /** All its cash in PLN (foreign currencies at the NBP mid rate). */
  cash: number;
  /** Per currency, when it holds any other than PLN: the amount, its PLN value (null without a rate) and the rate. */
  currencies?: Record<string, { amount: number; value: number | null; rate?: number }>;
  baseCurrency?: string;
}

export interface SnapshotItem {
  PK: "PORTFOLIO";
  SK: `SNAP#${IsoDate}` | "SNAP#LATEST";
  date: IsoDate;
  holdings: HoldingSnapshot[];
  /** value/cost/gain: positions; cash: accounts that are fully tracked (older snapshots have none). */
  totals: { value: number; cost: number; gain: number; couponsReceived: number; cash?: number };
  accounts?: Record<string, AccountSnapshot>;
  byType: Record<string, { value: number; cost: number }>;
  computedAt: string;
}

/** One position's value on one day (holdings table), for the Holdings view's row charts. */
export interface PositionDayItem {
  PK: `POS#${string}#${string}`; // POS#<account>#<isin>
  SK: IsoDate;
  account: string;
  isin: string;
  date: IsoDate;
  quantity: number;
  value: number | null;
  cost: number;
}

/**
 * One day of the portfolio's history (holdings table), for the Dashboard's charts: the part of the day's snapshot they
 * use, without its holdings (~250 bytes instead of ~15 KB), so a range of years is a few small pages.
 */
export interface HistoryPointItem {
  PK: "HISTORY";
  SK: IsoDate;
  date: IsoDate;
  totals: SnapshotItem["totals"];
  byType: SnapshotItem["byType"];
  /** Value per asset class (`valueByClass`): SHARES, BONDS, CASH, OTHER. */
  byClass: Record<string, number>;
  /** `snapshotFingerprint` of the day's snapshot as written: a revaluation that gets the same skips the day unread. */
  fingerprint?: string;
}

export type BackfillStatus = "pending" | "running" | "done" | "no_history" | "failed";

export interface BackfillItem {
  PK: `INST#${string}`;
  SK: "BACKFILL";
  isin: string;
  status: BackfillStatus;
  source?: string;
  from?: IsoDate;
  to?: IsoDate;
  rows?: number;
  note?: string;
  updatedAt: string;
}

/** One change to a transaction in the app (PK "TXLOG", SK "<at>#<id>"): the audit trail, kept for good. */
export interface TransactionLogItem {
  PK: "TXLOG";
  SK: string;
  at: string;
  action: "added" | "edited" | "deleted";
  /** The Cognito user name (or sub) of who made it. */
  by: string;
  before?: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
  after?: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
}

export interface JobRunItem {
  PK: `JOB#${string}`;
  SK: `RUN#${string}`;
  job: string;
  startedAt: string;
  finishedAt?: string;
  /** "running" from its start until it ends; one still running after the function's timeout timed out. */
  status: "running" | "ok" | "failed";
  itemsWritten?: number;
  /** The run had nothing to do (e.g. no instrument of its kind on this stage). */
  idle?: boolean;
  note?: string;
  ttl: number;
}

export const keys = {
  instrument: (isin: string) => ({ PK: `INST#${isin}` as const, SK: "META" as const }),
  price: (isin: string, venue: string, date: IsoDate) => ({ PK: `INST#${isin}` as const, SK: `PX#${venue}#${date}` as const }),
  pricePrefix: (isin: string, venue: string) => ({ PK: `INST#${isin}` as const, SK: `PX#${venue}#` as const }),
  referenceIndex: (month: string) => ({ PK: "CPI_REF" as const, SK: month }),
  gusCpi: (series: GusCpiSeries, month: string) => ({ PK: series, SK: month }),
  fxRate: (currency: string, date: IsoDate) => ({ PK: `FX#${currency}` as const, SK: date }),
  benchmarkPrice: (id: string, date: IsoDate) => ({ PK: `BENCH#${id}` as const, SK: date }),
  couponPeriod: (isin: string, start: IsoDate) => ({ PK: `INST#${isin}` as const, SK: `COUPON#${start}` as const }),
  transaction: (account: string, date: IsoDate, id: string) => ({ PK: `ACCT#${account}` as const, SK: `TX#${date}#${id}` as const }),
  snapshot: (date: IsoDate | "LATEST") => ({ PK: "PORTFOLIO" as const, SK: `SNAP#${date}` as const }),
  backfill: (isin: string) => ({ PK: `INST#${isin}` as const, SK: "BACKFILL" as const }),
  positionDay: (account: string, isin: string, date: IsoDate) => ({ PK: `POS#${account}#${isin}` as const, SK: date }),
  historyPoint: (date: IsoDate) => ({ PK: "HISTORY" as const, SK: date }),
  account: (account: string) => ({ PK: `ACCT#${account}` as const, SK: "META" as const }),
  note: (id: string) => ({ PK: `NOTE#${id}` as const, SK: "META" as const }),
  setting: (name: string) => ({ PK: `SETTING#${name}` as const, SK: "META" as const }),
  retailSeries: (series: string) => ({ PK: `SERIES#${series}` as const, SK: "META" as const }),
  jobRun: (job: string, startedAt: string) => ({ PK: `JOB#${job}` as const, SK: `RUN#${startedAt}` as const }),
};
