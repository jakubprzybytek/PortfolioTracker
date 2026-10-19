import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import type { FxHistory } from "./fx.ts";
import { Ledger } from "./ledger.ts";

/**
 * Units bought in one transaction and still held, with the cost of exactly those units, fees included: in PLN (a
 * purchase in another currency at the NBP rate of the day before, as Polish tax) and in the currency paid.
 */
export interface Lot {
  date: IsoDate;
  quantity: number;
  cost: number;
  costNative: number;
  currency: string;
}

/** The part of a disposal taken from one buy (FIFO): its units and what they cost, PLN, the buy's fee included. */
export interface RealisationPair {
  buyDate: IsoDate;
  quantity: number;
  cost: number;
}

/** One sale (or redemption) matched against the oldest lots: what it brought in and what those units cost. */
export interface Realisation {
  /** The transaction. */
  id: string;
  type: "SELL" | "REDEMPTION" | "WRITE_OFF";
  date: IsoDate;
  quantity: number;
  /** Cash received, net of the fee (PLN; in another currency at NBP D-1). */
  proceeds: number;
  /** Cost of the units sold (FIFO), PLN. */
  cost: number;
  /** The buys it was matched against, oldest first; their costs add up to `cost`. */
  pairs: RealisationPair[];
}

export interface Position {
  account: string;
  isin: string;
  quantity: number;
  /** Cost of the open quantity: the remaining lots (FIFO), fees included, PLN. */
  cost: number;
  /** The same in the currency paid, when every open lot was paid in one currency other than PLN. */
  costNative?: { amount: number; currency: string };
  /** Coupons, interest and dividends received, PLN (another currency at NBP D-1). */
  couponsReceived: number;
  firstDate: IsoDate;
  /** The most units held at once, and the most cost held at once (PLN): what a closed position was at its largest. */
  peakQuantity: number;
  peakCost: number;
  /** Open lots, oldest first. */
  lots: Lot[];
  realised: Realisation[];
}

/** Map key of a position: the same instrument in two accounts is two positions. */
export const positionKey = (account: string, isin: string): string => `${account}|${isin}`;


/**
 * Positions per account and ISIN on `date`, from all transactions up to and including it. Cost basis is FIFO, as in
 * the reference sheet and Polish tax: a sale takes the oldest lots first (a partly sold lot keeps its cost per unit).
 * Amounts in another currency than PLN count at the NBP rate of the day before (`fx`); without one, at the broker's
 * rate, else NaN.
 */
export function positionsAt(transactions: TransactionItem[], date: IsoDate, fx?: FxHistory): Map<string, Position> {
  return new Ledger(transactions, fx).advanceTo(date).positions();
}

/** Earliest transaction date, or undefined when there are none. */
export function firstTransactionDate(transactions: TransactionItem[]): IsoDate | undefined {
  return transactions.map((t) => t.date).sort()[0];
}
