// The transaction import file: a JSON array of these records (see Docs/backfill.md, step 3).

import { createHash } from "node:crypto";
import { z } from "zod";
import type { TransactionItem } from "../db/items.ts";

export const transactionTypes = ["BUY", "SELL", "COUPON", "REDEMPTION", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "INTEREST"] as const;

export const TransactionInput = z.object({
  id: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.string().min(1),
  type: z.enum(transactionTypes),
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/).optional(),
  quantity: z.number().positive().optional(),
  /** Bonds: clean price in % of nominal. */
  price: z.number().optional(),
  /** Signed cash effect: negative = money out (buys, fees), positive = money in (sells, coupons). */
  amount: z.number(),
  fee: z.number().nonnegative().optional(),
  /** Retail bonds: when interest starts (the purchase date), if not the transaction date. */
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().length(3).default("PLN"),
  note: z.string().optional(),
});
export type TransactionInput = z.input<typeof TransactionInput>;

export const TransactionFile = z.array(TransactionInput);

/** Deterministic id, so re-importing the same file never duplicates a row. */
export function transactionId(t: z.output<typeof TransactionInput>): string {
  if (t.id) return t.id;
  const h = createHash("sha256");
  // valueDate only when present, so ids of existing rows don't change.
  h.update([t.date, t.account, t.type, t.isin ?? "", t.quantity ?? "", t.amount, t.currency, ...(t.valueDate ? [t.valueDate] : [])].join("|"));
  return h.digest("hex").slice(0, 16);
}

export function parseTransactionFile(json: string, source: string): Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[] {
  const parsed = TransactionFile.parse(JSON.parse(json));
  return parsed.map((t) => {
    const { id: _ignored, ...rest } = t;
    return { ...rest, id: transactionId(t), source };
  });
}
