// Item shapes and key builders for the DynamoDB tables market, transactions and holdings (see Docs/data-storage.md).

import type { IsoDate } from "../dates.ts";
import type { BondTerms } from "../bonds/terms.ts";
import type { RetailTerms } from "../mf/retailRates.ts";

export type InstrumentType = "BOND_LISTED" | "BOND_RETAIL" | "ETF" | "BOND_IBKR" | "FUND_MANUAL" | "CASH";

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
  live: boolean;
  terms?: BondTerms;
  /** Retail treasury bonds: the series' terms and published rates (from the Ministry file). */
  retail?: RetailTerms;
  updatedAt: string;
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

export interface CouponRateItem {
  PK: `INST#${string}`;
  SK: `COUPON#${IsoDate}`;
  isin: string;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  rate: number;
  source: string;
}

/** Account metadata: which kinds of assets of this account aren't tracked yet (from the sheet import). */
export interface AccountItem {
  PK: `ACCT#${string}`;
  SK: "META";
  GSI1PK: "ACCOUNT";
  GSI1SK: string; // account
  account: string;
  incomplete?: string[];
  updatedAt: string;
}

export type TransactionType =
  | "BUY"
  | "SELL"
  | "COUPON"
  | "REDEMPTION"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "FEE"
  | "TAX"
  | "INTEREST";

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
  price?: number; // bonds: clean % of nominal; retail bonds: PLN per 100 PLN bond
  /** Retail bonds: when interest starts (the purchase date), if not the transaction date. */
  valueDate?: IsoDate;
  amount: number; // signed cash effect in `currency`: negative = money out
  fee?: number;
  currency: string;
  note?: string;
  source: string;
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
  nominal: number | null;
  accruedInterest: number | null;
  valuePerUnit: number | null;
  value: number | null;
  cost: number;
  couponsReceived: number;
  gain: number | null;
  gainPct: number | null;
  flags: string[];
  /** Retail bonds: annual rate of the current period and of the one before (null in the first). */
  rate?: { current: number; previous: number | null };
}

/** An account's cash, and whether all of its assets are tracked (`incomplete` lists what isn't yet). */
export interface AccountSnapshot {
  cash: number;
  incomplete?: string[];
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

export interface JobRunItem {
  PK: `JOB#${string}`;
  SK: `RUN#${string}`;
  job: string;
  startedAt: string;
  finishedAt?: string;
  status: "ok" | "failed";
  itemsWritten?: number;
  note?: string;
  ttl: number;
}

export const keys = {
  instrument: (isin: string) => ({ PK: `INST#${isin}` as const, SK: "META" as const }),
  price: (isin: string, venue: string, date: IsoDate) => ({ PK: `INST#${isin}` as const, SK: `PX#${venue}#${date}` as const }),
  pricePrefix: (isin: string, venue: string) => ({ PK: `INST#${isin}` as const, SK: `PX#${venue}#` as const }),
  referenceIndex: (month: string) => ({ PK: "CPI_REF" as const, SK: month }),
  couponRate: (isin: string, periodStart: IsoDate) => ({ PK: `INST#${isin}` as const, SK: `COUPON#${periodStart}` as const }),
  transaction: (account: string, date: IsoDate, id: string) => ({ PK: `ACCT#${account}` as const, SK: `TX#${date}#${id}` as const }),
  snapshot: (date: IsoDate | "LATEST") => ({ PK: "PORTFOLIO" as const, SK: `SNAP#${date}` as const }),
  backfill: (isin: string) => ({ PK: `INST#${isin}` as const, SK: "BACKFILL" as const }),
  positionDay: (account: string, isin: string, date: IsoDate) => ({ PK: `POS#${account}#${isin}` as const, SK: date }),
  account: (account: string) => ({ PK: `ACCT#${account}` as const, SK: "META" as const }),
  retailSeries: (series: string) => ({ PK: `SERIES#${series}` as const, SK: "META" as const }),
  jobRun: (job: string, startedAt: string) => ({ PK: `JOB#${job}` as const, SK: `RUN#${startedAt}` as const }),
};
