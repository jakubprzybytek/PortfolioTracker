// Instrument import file: a JSON array of instruments to track. Bond terms may be given inline
// or, for Polish treasury series, resolved from the imported Ministry of Finance calculator by code.

import { z } from "zod";

const CouponPeriod = z.object({
  start: z.string(),
  end: z.string(),
  paymentDate: z.string().optional(),
  rate: z.number().optional(),
  amount: z.number().optional(),
});

export const BondTermsInput = z.object({
  nominal: z.number().positive().default(1000),
  currency: z.string().length(3).default("PLN"),
  couponType: z.enum(["FIXED", "FLOATING", "INDEXED"]),
  couponRate: z.number().optional(),
  referenceRate: z.string().optional(),
  margin: z.number().optional(),
  issueDate: z.string().optional(),
  maturity: z.string(),
  baseRef: z.number().optional(),
  periods: z.array(CouponPeriod),
});

export const InstrumentInput = z.object({
  isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/),
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["BOND_LISTED", "BOND_RETAIL", "ETF", "BOND_IBKR", "FUND_MANUAL", "CASH"]),
  currency: z.string().length(3).default("PLN"),
  venue: z.string().default("XWAR"),
  sourceIds: z.record(z.string(), z.string()).default({}),
  active: z.boolean().default(true),
  live: z.boolean().default(false),
  /**
   * "mf" = look the terms up in the imported MF calculator data by `code` (treasury bonds on GPW);
   * "mf-retail" = the retail series `code` (e.g. EDO0332) from the imported Ministry retail-bond file.
   */
  terms: z.union([z.literal("mf"), z.literal("mf-retail"), BondTermsInput]).optional(),
  /** Share splits (ETFs): from `date` on, one unit became `ratio` units. */
  splits: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ratio: z.number().positive() })).optional(),
});
export type InstrumentInput = z.output<typeof InstrumentInput>;

export const InstrumentFile = z.array(InstrumentInput);

export function parseInstrumentFile(json: string): InstrumentInput[] {
  return InstrumentFile.parse(JSON.parse(json));
}
