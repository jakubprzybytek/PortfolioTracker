// One-off backfill (scripts/backfill-tax.ts): money in entered before the `tax` field kept the tax withheld in its
// note ("Pobrany podatek: 61.56 PLN", "Tax: 2.16 zł"). This moves it into `tax` and takes the line out of the note.

import type { TransactionItem } from "../db/items.ts";
import { TAXED_TYPES } from "./manual.ts";

/** A whole note line giving the tax: "Pobrany podatek: 4.1 PLN", "Tax: 2.16 zł", "Tax paid: 19,00 PLN". */
const LINE = /^\s*(?:pobrany podatek|tax(?: paid)?)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(PLN|zł|EUR|USD)?\s*$/im;

export interface TaxBackfill {
  tax: number;
  /** The note without the tax line; undefined when nothing else was in it. */
  note: string | undefined;
}

/**
 * The tax to move out of a transaction's note, or undefined: not money in, `tax` set already, no such line, or a
 * line in another currency than the transaction's.
 */
export function taxFromNoteLine(t: Pick<TransactionItem, "type" | "note" | "currency" | "tax">): TaxBackfill | undefined {
  if (!TAXED_TYPES.has(t.type) || t.tax !== undefined || !t.note) return undefined;
  const m = LINE.exec(t.note);
  if (!m) return undefined;
  const cur = m[2] === "zł" ? "PLN" : m[2];
  if (cur && cur !== t.currency) return undefined;
  const tax = Number(m[1]!.replace(",", "."));
  if (!(tax > 0)) return undefined;
  const rest = t.note
    .replace(LINE, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return { tax, note: rest || undefined };
}
