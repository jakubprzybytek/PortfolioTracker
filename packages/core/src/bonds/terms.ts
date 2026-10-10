import type { IsoDate } from "../dates.ts";

export type CouponType = "FIXED" | "FLOATING" | "INDEXED";

export interface CouponPeriod {
  start: IsoDate; // first day of the interest period (inclusive)
  end: IsoDate; // last day (exclusive) = start of the next period
  paymentDate: IsoDate; // when the coupon is paid (may be after `end` when `end` is a holiday)
  /** Annual rate for this period. Required for FLOATING; for others defaults to `couponRate`. */
  rate?: number;
  /** Coupon amount per bond as published, when known (used as a check). */
  amount?: number;
}

export interface BondTerms {
  isin: string;
  code: string; // exchange code, e.g. DS0432
  nominal: number; // face value per bond, before any indexation
  currency: string;
  couponType: CouponType;
  /** Annual coupon rate for FIXED and INDEXED, e.g. 0.0175. */
  couponRate?: number;
  /** Reference rate name + margin for FLOATING, e.g. WIBOR6M + 0.04. Informational only. */
  referenceRate?: string;
  margin?: number;
  issueDate?: IsoDate;
  maturity: IsoDate;
  /** INDEXED only: reference index at issue, e.g. IZ0836 = 194.28509. */
  baseRef?: number;
  periods: CouponPeriod[];
}

/** The coupon period containing `date` (start <= date < end), or undefined outside the bond's life. */
export function periodAt(terms: BondTerms, date: IsoDate): CouponPeriod | undefined {
  return terms.periods.find((p) => p.start <= date && date < p.end);
}
