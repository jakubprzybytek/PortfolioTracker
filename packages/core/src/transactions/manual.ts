// Transactions and instruments entered in the app (the "Add transaction" form), as opposed to imported files.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { BondTerms } from "../bonds/terms.ts";
import { listingFromTicker } from "../instruments/listing.ts";
import type { InstrumentInput } from "../instruments/schema.ts";
import { privateAssetId } from "../prices/manual.ts";
import type { RetailTerms } from "../mf/retailRates.ts";
import { RETAIL_LABELS } from "./fromSheet.ts";
import { TransactionInput } from "./schema.ts";

/** Source of transactions entered in the app. */
export const APP_SOURCE = "app";

/** A transaction from the form: the import record without an id (the server gives one). */
export const ManualTransaction = TransactionInput.omit({ id: true });
export type ManualTransaction = z.output<typeof ManualTransaction>;

/** Types that need an instrument (the rest are cash movements of the account). */
export const INSTRUMENT_TYPES = new Set(["BUY", "SELL", "COUPON", "REDEMPTION", "DIVIDEND", "SPLIT"]);

/** 2026-02-30 has the right shape but isn't a day. */
export const isCalendarDate = (d: string): boolean => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/**
 * Checks what the schema can't: a real calendar date, an instrument where the type needs one, a quantity for trades, a ratio for splits.
 * Returns the problems (empty = fine).
 */
export function checkManualTransaction(t: ManualTransaction, knownIsins: Set<string>): string[] {
  const problems: string[] = [];
  for (const [field, d] of [["date", t.date], ["valueDate", t.valueDate]] as const) if (d !== undefined && !isCalendarDate(d)) problems.push(`${field}: ${d} is not a date`);
  if (INSTRUMENT_TYPES.has(t.type) && !t.isin) problems.push(`${t.type} needs an instrument`);
  if (t.isin && !knownIsins.has(t.isin)) problems.push(`Unknown instrument ${t.isin}: add it first`);
  if ((t.type === "BUY" || t.type === "SELL") && !t.quantity) problems.push(`${t.type} needs a quantity`);
  if (t.type === "SPLIT" && !t.ratio) problems.push("SPLIT needs a ratio");
  if (t.type === "EXCHANGE") {
    if (!t.toAmount || !t.toCurrency) problems.push("EXCHANGE needs what came in: toAmount and toCurrency");
    else if (t.toCurrency === t.currency) problems.push("EXCHANGE: the two currencies must differ");
  }
  if ((t.type === "BUY" || t.type === "FEE" || t.type === "TAX" || t.type === "WITHDRAWAL" || t.type === "EXCHANGE") && t.amount > 0) problems.push(`${t.type}: the amount is money out, so negative`);
  if ((t.type === "SELL" || t.type === "DEPOSIT" || t.type === "COUPON" || t.type === "INTEREST" || t.type === "DIVIDEND" || t.type === "REDEMPTION") && t.amount < 0)
    problems.push(`${t.type}: the amount is money in, so positive`);
  return problems;
}

/** Random id: a transaction typed in the app has no file row to derive one from. */
export const newTransactionId = (): string => randomBytes(8).toString("hex");

const pct = (rate: number) => `${(Math.round(rate * 10000) / 100).toString().replace(".", ",")} %`;

/** A retail treasury series (EDO1036 …) from the Ministry file, as an instrument to track (valued from the published rates). */
export function retailInstrument(t: Pick<RetailTerms, "series" | "isin" | "kind">): InstrumentInput {
  return {
    isin: t.isin,
    code: t.series,
    name: `Obligacje skarbowe ${t.series} (${RETAIL_LABELS[t.kind] ?? t.kind})`,
    type: "BOND_RETAIL",
    currency: "PLN",
    venue: "CALC",
    sourceIds: {},
    active: true,
    live: false,
    terms: "mf-retail",
  };
}

/** A treasury bond listed on GPW (DS1030, IZ0836 …) from the MF calculator's terms, priced from GPW. */
export function listedTreasuryInstrument(t: Pick<BondTerms, "isin" | "code" | "couponType" | "couponRate">): InstrumentInput {
  const kind =
    t.couponType === "FIXED" ? `stałe${t.couponRate !== undefined ? ` ${pct(t.couponRate)}` : ""}` : t.couponType === "INDEXED" ? `indeksowane inflacją${t.couponRate !== undefined ? `, ${pct(t.couponRate)}` : ""}` : "zmienne";
  return {
    isin: t.isin,
    code: t.code,
    name: `Obligacje skarbowe ${t.code} (${kind})`,
    type: "BOND_LISTED",
    currency: "PLN",
    venue: "XWAR",
    sourceIds: { gpw: t.code },
    active: true,
    live: false,
    terms: "mf",
  };
}

/** A corporate bond on Catalyst, priced from BiznesRadar by its code; prices are % of `nominal`. */
export function corporateInstrument(i: { isin: string; code: string; name: string; nominal: number }): InstrumentInput {
  return { isin: i.isin, code: i.code, name: i.name, type: "BOND_CORPORATE", currency: "PLN", venue: "CATALYST", sourceIds: { biznesradar: i.code }, active: true, live: false, nominal: i.nominal };
}

/** An ETF from its exchange ticker ("AMS:VWRL", "FRA:EUNK"): venue and Yahoo symbol from the exchange. Undefined for an unknown exchange. */
export function etfInstrument(i: { isin: string; ticker: string; name: string; currency: string }): InstrumentInput | undefined {
  const l = listingFromTicker(i.ticker);
  if (!l) return undefined;
  return { isin: i.isin, code: l.code, name: i.name, type: "ETF", currency: i.currency, venue: l.venue, sourceIds: { yahoo: l.yahoo }, active: true, live: false };
}

/** An asset valued by hand (a flat, a private loan …): its value comes from manual prices. */
export function manualInstrument(i: { code: string; name: string }): InstrumentInput {
  return { isin: privateAssetId(i.code), code: i.code, name: i.name, type: "FUND_MANUAL", currency: "PLN", venue: "MANUAL", sourceIds: {}, active: true, live: false };
}

/** "Add instrument" from the form: the kind and the few fields it needs (the rest follows from the kind). */
export const NewInstrument = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("treasury"), code: z.string().trim().min(1) }),
  z.object({ kind: z.literal("etf"), isin: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/), ticker: z.string().trim().min(3), name: z.string().trim().min(1), currency: z.string().trim().length(3) }),
  z.object({ kind: z.literal("corporate"), isin: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/), code: z.string().trim().min(1), name: z.string().trim().min(1), nominal: z.number().positive() }),
  z.object({ kind: z.literal("manual"), code: z.string().trim().min(1), name: z.string().trim().min(1) }),
]);
export type NewInstrument = z.output<typeof NewInstrument>;
