// Corporate bonds' coupon periods (Docs/data-sources.md, "Accrued interest"): accrued interest from each period's
// rate, the rates your coupons imply, and how a fresh copy of the terms from obligacje.pl is merged into what's stored.
// Interest is ACT/365, as in the terms of issue of Catalyst corporate bonds: nominal × rate × days / 365, per bond,
// rounded to the grosz.

import { z } from "zod";
import { addDays, daysBetween, type IsoDate } from "../dates.ts";
import { isCalendarDate } from "../transactions/manual.ts";
import type { CouponPeriodItem, CouponSource, TransactionItem } from "../db/items.ts";
import { settlementDate } from "../settlement.ts";
import { round2 } from "./izIndex.ts";

export type InterestPeriod = Omit<CouponPeriodItem, "PK" | "SK" | "updatedAt">;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isCalendarDate, "not a calendar date");
const source = z.enum(["manual", "obligacje.pl", "coupons"]);

/** A period as in the backup file (imports/coupons/) and as sent by the app; dates must fit together. */
export const CouponPeriodInput = z
  .object({
    isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}\d$/),
    start: day,
    end: day,
    recordDate: day.optional(),
    paymentDate: day,
    datesSource: source.default("manual"),
    /** Annual, as a fraction (0.0713 = 7.13 %). */
    rate: z.number().gt(0).lt(1).optional(),
    rateSource: source.optional(),
    otherRate: z.object({ rate: z.number(), source, seenAt: z.string() }).optional(),
  })
  .refine((p) => p.start < p.end, { message: "the period must end after it starts", path: ["end"] })
  .refine((p) => p.paymentDate >= p.end, { message: "the coupon is paid on or after the period's end", path: ["paymentDate"] })
  .refine((p) => !p.recordDate || (p.recordDate > p.start && p.recordDate <= p.paymentDate), { message: "the record day lies within the period, before the payment", path: ["recordDate"] })
  .refine((p) => p.rate === undefined || p.rateSource !== undefined, { message: "a rate needs its source", path: ["rateSource"] });

export function parseCouponPeriods(json: string): InterestPeriod[] {
  return z.array(CouponPeriodInput).parse(JSON.parse(json));
}

/** Polish tax on interest, withheld by the broker outside IKE/IKZE. */
export const INTEREST_TAX = 0.19;
/** A coupon is booked within this many days after its payment day (weekends, holidays, a late broker). */
const PAYMENT_GRACE_DAYS = 10;

/** Interest of one bond for `days` of the period, in its currency. */
const interest = (nominal: number, rate: number, days: number) => round2((nominal * rate * days) / 365);

/** The whole coupon of a period per bond (undefined without a rate). */
export const couponPerBond = (nominal: number, p: Pick<InterestPeriod, "start" | "end" | "rate">): number | undefined =>
  p.rate === undefined ? undefined : interest(nominal, p.rate, daysBetween(p.start, p.end));

export interface CorporateAccrued {
  /** Total accrued interest of the position (null: a period has no rate, or there are no periods). */
  total: number | null;
  rate?: { current: number; previous: number | null };
  /** Set when `total` is null: the period without a rate (null: no periods known). */
  missingFrom?: IsoDate | null;
}

/**
 * Accrued interest of a position of `quantity` bonds on `date`, counted to `settle` (the settlement day of a sale on
 * `date`, T+2, as Catalyst quotes it; `date` itself when not given). Within a period it grows by day; from the record
 * day on, the whole coupon is due to whoever held the bond that day (`heldOn`), and stays counted until its payment
 * day (when that's after the period's end). Bonds bought after the record day earn nothing until the next period.
 */
export function corporateAccrued(
  periods: InterestPeriod[],
  nominal: number,
  date: IsoDate,
  quantity: number,
  heldOn: (day: IsoDate) => number,
  settle: IsoDate = date,
): CorporateAccrued {
  if (periods.length === 0) return { total: null, missingFrom: null };
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  const i = sorted.findIndex((p) => p.start <= settle && settle < p.end);
  let total = 0;
  let missingFrom: IsoDate | undefined;

  // A coupon of an ended period not paid yet (its payment day falls after the period's end).
  for (const p of sorted)
    if (p.end <= settle && date < p.paymentDate) {
      const coupon = couponPerBond(nominal, p);
      if (coupon === undefined) missingFrom ??= p.start;
      else total += coupon * Math.min(quantity, heldOn(p.recordDate ?? addDays(p.end, -1)));
    }

  const current = i >= 0 ? sorted[i]! : undefined;
  if (current) {
    if (current.rate === undefined) missingFrom ??= current.start;
    else if (current.recordDate && settle >= current.recordDate) total += couponPerBond(nominal, current)! * Math.min(quantity, heldOn(current.recordDate));
    else total += interest(nominal, current.rate, daysBetween(current.start, settle)) * quantity;
  }
  if (missingFrom !== undefined) return { total: null, missingFrom };
  const previous = i > 0 ? (sorted[i - 1]!.rate ?? null) : null;
  return { total: round2(total), ...(current?.rate !== undefined ? { rate: { current: current.rate, previous } } : {}) };
}

/**
 * Bonds of one ISIN an account owns at the end of `day`: trades count once settled (T+2), so a bond bought on the
 * record day (or the day before) doesn't get that coupon and one sold then still does. Redemptions count on their date.
 */
export function quantityHeld(transactions: TransactionItem[], account: string, isin: string, day: IsoDate): number {
  let q = 0;
  for (const t of transactions) {
    if (t.account !== account || t.isin !== isin || t.quantity === undefined) continue;
    const settled = t.type === "REDEMPTION" ? t.date : settlementDate(t.date);
    if (settled > day) continue;
    if (t.type === "BUY") q += t.quantity;
    else if (t.type === "SELL" || t.type === "REDEMPTION") q -= t.quantity;
  }
  return q;
}

/** The tax a broker withheld, from the note it came with ("Pobrany podatek: 61.56 PLN"). */
export function taxFromNote(note: string | undefined): number | undefined {
  const m = /podatek:?\s*(\d[\d\s]*(?:[.,]\d+)?)/i.exec(note ?? "");
  return m ? Number(m[1]!.replace(/\s/g, "").replace(",", ".")) : undefined;
}

/** IKE and IKZE accounts pay coupons without tax. */
export const isTaxFreeAccount = (account: string) => /\bIKZ?E\b/i.test(account);

export interface CouponCheck {
  account: string;
  date: IsoDate;
  /** As booked (after tax). */
  amount: number;
  /** Before tax: the amount plus the tax in its note; in IKE/IKZE the amount; otherwise assumed taxed at 19 %. */
  gross: number;
  taxAssumed: boolean;
  /** Bonds held on the record day. */
  quantity: number;
  /** Annual rates that give this coupon per bond (rounded to the grosz): [low, high]. */
  rateRange: [number, number];
  /** The coupon the period's rate gives (gross), when it has one. */
  expected?: number;
  /** The coupon differs from the expected one by more than rounding. */
  mismatch?: boolean;
}

export interface PeriodCoupons {
  start: IsoDate;
  checks: CouponCheck[];
  /** A rate (0.01 % steps) that all of the period's coupons agree on; absent when they don't. */
  suggestedRate?: number;
}

/**
 * Matches the coupons received for one bond (all accounts) to its periods: each to the latest period paid on or before
 * its date (within a few days), and works out the rate each implies. Coupons that fit no period are returned apart.
 */
export function couponChecks(periods: InterestPeriod[], nominal: number, transactions: TransactionItem[], isin: string): { periods: PeriodCoupons[]; unmatched: TransactionItem[] } {
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  const out = new Map<IsoDate, PeriodCoupons>();
  const unmatched: TransactionItem[] = [];
  for (const t of transactions) {
    if (t.type !== "COUPON" || t.isin !== isin) continue;
    const p = [...sorted].reverse().find((p) => p.paymentDate <= t.date && t.date <= addDays(p.paymentDate, PAYMENT_GRACE_DAYS));
    const quantity = p ? quantityHeld(transactions, t.account, isin, p.recordDate ?? addDays(p.end, -1)) : 0;
    if (!p || quantity <= 0) {
      unmatched.push(t);
      continue;
    }
    const tax = taxFromNote(t.note);
    const taxFree = tax === undefined && isTaxFreeAccount(t.account);
    const gross = round2(tax !== undefined ? t.amount + tax : taxFree ? t.amount : t.amount / (1 - INTEREST_TAX));
    const taxAssumed = tax === undefined && !taxFree;
    const days = daysBetween(p.start, p.end);
    const perBond = gross / quantity;
    // Per-bond coupons are rounded to the grosz: every rate within half a grosz per bond gives the same coupon (an
    // assumed tax adds its own rounding).
    const slack = taxAssumed ? 0.01 : 0.005;
    const rateAt = (amount: number) => Number(((amount * 365) / (nominal * days)).toFixed(6));
    const check: CouponCheck = { account: t.account, date: t.date, amount: t.amount, gross, taxAssumed, quantity, rateRange: [rateAt(perBond - slack), rateAt(perBond + slack)] };
    const coupon = couponPerBond(nominal, p);
    if (coupon !== undefined) {
      check.expected = round2(coupon * quantity);
      check.mismatch = Math.abs(check.expected - gross) > (taxAssumed ? 0.02 * quantity + 0.05 : 0.01);
    }
    const entry = out.get(p.start) ?? { start: p.start, checks: [] };
    entry.checks.push(check);
    out.set(p.start, entry);
  }
  for (const entry of out.values()) {
    const low = Math.max(...entry.checks.map((c) => c.rateRange[0]));
    const high = Math.min(...entry.checks.map((c) => c.rateRange[1]));
    if (low > high) continue;
    // The rate in 0.01 % steps nearest the middle of what fits (rates are quoted to the hundredth of a percent).
    const mid = (low + high) / 2;
    const step = Number((Math.round(mid * 10_000) / 10_000).toFixed(4));
    entry.suggestedRate = step >= low && step <= high ? step : Number(mid.toFixed(6));
  }
  return { periods: [...out.values()].sort((a, b) => a.start.localeCompare(b.start)), unmatched };
}

export interface PublishedTerms {
  periods: { start: IsoDate; end: IsoDate; recordDate?: IsoDate; paymentDate: IsoDate }[];
  /** Rate of the period running today (floating: the site's "current rate"). */
  currentRate: number | null;
  /** Fixed-coupon bonds: one rate for every period. */
  fixedRate?: number | null;
}

/**
 * Merges terms from obligacje.pl into a bond's stored periods. It adds periods that are missing (and don't overlap a
 * stored one) and fills rates that are missing, never changing a stored date or rate: a different rate is kept aside
 * as `otherRate` for you to look at. The current rate counts only once the period is a week old, or when it differs
 * from the period before (the site can show the old rate for a few days after a new period starts).
 * Returns the periods to write and the first day whose rate changed (a revaluation starts there).
 */
export function mergePublishedTerms(isin: string, stored: InterestPeriod[], terms: PublishedTerms, today: IsoDate, now: string): { put: InterestPeriod[]; ratesFrom?: IsoDate } {
  const byStart = new Map(stored.map((p) => [p.start, { ...p }]));
  const changed = new Set<IsoDate>();
  let ratesFrom: IsoDate | undefined;
  const source: CouponSource = "obligacje.pl";
  const setRate = (p: InterestPeriod, rate: number) => {
    if (p.rate === undefined) {
      p.rate = rate;
      p.rateSource = source;
      delete p.otherRate;
      if (!ratesFrom || p.start < ratesFrom) ratesFrom = p.start;
      changed.add(p.start);
    } else if (Math.abs(p.rate - rate) > 1e-7) {
      if (p.otherRate?.rate !== rate) {
        p.otherRate = { rate, source, seenAt: now };
        changed.add(p.start);
      }
    } else if (p.otherRate) {
      delete p.otherRate;
      changed.add(p.start);
    }
  };

  for (const t of terms.periods) {
    const existing = byStart.get(t.start);
    if (existing) {
      if (!existing.recordDate && t.recordDate) {
        existing.recordDate = t.recordDate;
        changed.add(t.start);
      }
      continue;
    }
    const overlaps = [...byStart.values()].some((p) => p.start < t.end && t.start < p.end);
    if (overlaps) continue;
    byStart.set(t.start, { isin, start: t.start, end: t.end, ...(t.recordDate ? { recordDate: t.recordDate } : {}), paymentDate: t.paymentDate, datesSource: source });
    changed.add(t.start);
  }

  const all = [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (terms.fixedRate != null) for (const p of all) setRate(p, terms.fixedRate);
  else if (terms.currentRate !== null) {
    const i = all.findIndex((p) => p.start <= today && today < p.end);
    const current = all[i];
    if (current) {
      const previous = i > 0 ? all[i - 1]!.rate : undefined;
      const settled = daysBetween(current.start, today) >= 7 || previous === undefined || Math.abs(previous - terms.currentRate) > 1e-7;
      if (settled) setRate(current, terms.currentRate);
    }
  }
  return { put: all.filter((p) => changed.has(p.start)), ...(ratesFrom ? { ratesFrom } : {}) };
}
