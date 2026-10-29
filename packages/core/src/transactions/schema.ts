// The transaction import file: a JSON array of these records (see Docs/backfill.md, step 3).

import { createHash } from "node:crypto";
import { z } from "zod";
import type { TransactionItem } from "../db/items.ts";

export const transactionTypes = ["BUY", "SELL", "COUPON", "REDEMPTION", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "INTEREST", "DIVIDEND", "SPLIT", "EXCHANGE", "WRITE_OFF"] as const;

/** An account name: up to 100 characters, no "#" (it separates the parts of the table keys). */
export const ACCOUNT_NAME = /^[^#]{1,100}$/;

export const TransactionInput = z.object({
  id: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.string().regex(ACCOUNT_NAME, "1–100 characters, no #"),
  type: z.enum(transactionTypes),
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/).optional(),
  quantity: z.number().positive().optional(),
  /** Bonds: clean price in % of nominal; ETFs: in the instrument's currency. */
  price: z.number().optional(),
  /** Paid in PLN for an instrument in another currency: the broker's PLN per unit of the instrument's currency. */
  fxRate: z.number().positive().optional(),
  /** EXCHANGE: the amount received (positive) and its currency; `amount` (negative) is what was given in `currency`. */
  toAmount: z.number().positive().optional(),
  toCurrency: z.string().length(3).optional(),
  /** SPLIT: each unit held becomes `ratio` units (amount 0). */
  ratio: z.number().positive().optional(),
  /** Signed cash effect in `currency`: negative = money out (buys, fees), positive = money in (sells, coupons). */
  amount: z.number(),
  /** In `currency`. */
  fee: z.number().nonnegative().optional(),
  /** Retail bonds: when interest starts (the purchase date), if not the transaction date. */
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().length(3).default("PLN"),
  note: z.string().optional(),
  /** Where the row came from ("app", an import file): kept by a backup, so a restore doesn't relabel app entries. */
  source: z.string().optional(),
});
export type TransactionInput = z.input<typeof TransactionInput>;

export const TransactionFile = z.array(TransactionInput);

/** Deterministic id, so re-importing the same file never duplicates a row. */
export function transactionId(t: z.output<typeof TransactionInput>): string {
  if (t.id) return t.id;
  const h = createHash("sha256");
  // valueDate and ratio only when present, so ids of existing rows don't change.
  h.update(
    [
      t.date,
      t.account,
      t.type,
      t.isin ?? "",
      t.quantity ?? "",
      t.amount,
      t.currency,
      ...(t.valueDate ? [t.valueDate] : []),
      ...(t.ratio ? [`ratio=${t.ratio}`] : []),
      ...(t.toCurrency ? [`to=${t.toAmount}${t.toCurrency}`] : []),
    ].join("|"),
  );
  return h.digest("hex").slice(0, 16);
}

export function parseTransactionFile(json: string, source: string): Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[] {
  const parsed = TransactionFile.parse(JSON.parse(json));
  return parsed.map((t) => {
    const { id: _ignored, ...rest } = t;
    return { ...rest, id: transactionId(t), source: rest.source ?? source };
  });
}
