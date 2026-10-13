// The backup of what the app can't fetch again: accounts, instruments, hand-entered prices and transactions, each in
// its import file format (data/README.md). Restoring = uploading the files to imports/<kind>/ in that order.

import type { AccountItem, InstrumentItem, PriceItem, TransactionItem } from "../db/items.ts";
import type { InstrumentInput } from "../instruments/schema.ts";
import type { ManualPriceInput } from "../prices/manual.ts";
import type { TransactionInput } from "../transactions/schema.ts";

/** In restore order. */
export const EXPORT_KINDS = ["accounts", "instruments", "prices", "transactions"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** Not instruments: the MF calculator terms are kept as a pseudo-instrument (restored by importing the calculator). */
const PSEUDO = new Set(["MF-TERMS"]);

/** An instrument as an import record: treasury terms by reference (resolved again on import), the rest as stored. */
export function instrumentInput(i: InstrumentItem): InstrumentInput {
  const terms = i.type === "BOND_RETAIL" ? ("mf-retail" as const) : i.terms ? ("mf" as const) : undefined;
  return {
    isin: i.isin,
    code: i.code,
    name: i.name,
    type: i.type,
    currency: i.currency,
    venue: i.venue,
    sourceIds: i.sourceIds,
    active: i.active,
    live: i.live,
    ...(terms ? { terms } : {}),
    ...(i.nominal ? { nominal: i.nominal } : {}),
    ...(i.pricePath?.length ? { pricePath: i.pricePath } : {}),
    ...(i.splits?.length ? { splits: i.splits } : {}),
  };
}

export function exportFiles(data: { accounts: AccountItem[]; instruments: InstrumentItem[]; manualPrices: PriceItem[]; transactions: TransactionItem[] }): Record<ExportKind, unknown[]> {
  const accounts = [...data.accounts]
    .sort((a, b) => a.account.localeCompare(b.account))
    .map((a) => ({ account: a.account, ...(a.incomplete?.length ? { incomplete: a.incomplete } : {}), ...(a.baseCurrency ? { baseCurrency: a.baseCurrency } : {}) }));
  const instruments = data.instruments
    .filter((i) => !PSEUDO.has(i.isin))
    .sort((a, b) => a.isin.localeCompare(b.isin))
    .map(instrumentInput);
  const prices: ManualPriceInput[] = data.manualPrices
    .filter((p) => p.venue === "MANUAL")
    .sort((a, b) => a.isin.localeCompare(b.isin) || a.date.localeCompare(b.date))
    .map((p) => ({ isin: p.isin, date: p.date, price: p.close, currency: p.currency, ...(p.flags?.length ? { note: p.flags.join("; ") } : {}) }));
  // With id and source, so a restore gives the same rows (same keys; "app" stays "app").
  const transactions: TransactionInput[] = [...data.transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account) || a.id.localeCompare(b.id))
    .map(({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...t }) => t);
  return { accounts, instruments, prices, transactions };
}
