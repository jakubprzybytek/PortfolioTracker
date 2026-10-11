// Manual prices: a JSON array uploaded to imports/prices/ for assets with no price source (e.g. a property fund
// share). Stored as ordinary daily price items with venue MANUAL, so valuation treats them like any price.

import { z } from "zod";
import type { PriceItem } from "../db/items.ts";

export const ManualPriceInput = z.object({
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Price per unit in `currency`. */
  price: z.number().positive(),
  currency: z.string().length(3).default("PLN"),
  note: z.string().optional(),
});
export type ManualPriceInput = z.input<typeof ManualPriceInput>;

export function parseManualPrices(json: string, source: string): PriceItem[] {
  const fetchedAt = new Date().toISOString();
  return z
    .array(ManualPriceInput)
    .parse(JSON.parse(json))
    .map((p) => ({
      PK: `INST#${p.isin}` as const,
      SK: `PX#MANUAL#${p.date}` as const,
      isin: p.isin,
      venue: "MANUAL",
      date: p.date,
      open: null,
      high: null,
      low: null,
      close: p.price,
      volume: 0,
      trades: 0,
      turnover: 0,
      traded: false,
      currency: p.currency,
      source,
      fetchedAt,
      status: "final",
      ...(p.note ? { flags: [p.note] } : {}),
    }));
}

/**
 * Internal id for an asset without an ISIN, in ISIN format so it fits everywhere an ISIN does. "ZZ" is an
 * ISO 3166 user-assigned code, so it never collides with a real ISIN. "Rzeszów" → "ZZRZESZOW000".
 */
export function privateAssetId(name: string): string {
  const letters = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return `ZZ${letters.slice(0, 9).padEnd(9, "0")}0`;
}
