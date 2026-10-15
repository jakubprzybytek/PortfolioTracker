import { daysBetween, type IsoDate } from "../dates.ts";
import { settlementDate } from "../settlement.ts";
import { round2, type ReferenceIndex, indexRatioAt } from "./izIndex.ts";
import { periodAt, type BondTerms, type CouponPeriod } from "./terms.ts";

export interface BondValuationInputs {
  /** INDEXED bonds: the reference index (monthly W values). */
  referenceIndex?: ReferenceIndex;
  /** FLOATING bonds: fallback rate when the period has none. */
  periodRate?: number;
}

export interface BondValuation {
  /** Nominal per bond on the date (indexed for IZ bonds). */
  nominal: number;
  /** Accrued interest per bond, in currency, rounded to 0.01. */
  accruedInterest: number;
  /** The annual rate used for the current period. */
  rate: number;
  indexRatio?: number;
  /** Set when a value could not be computed; the caller decides how to flag it. */
  problem?: "no_period" | "missing_coupon_rate" | "missing_reference_index";
}

/**
 * Accrued interest per bond on `date` (ACT/ACT: days since period start over days in the period),
 * plus the nominal in force that day. Follows the Ministry of Finance calculator for treasury bonds.
 */
export function valueBond(terms: BondTerms, date: IsoDate, inputs: BondValuationInputs = {}): BondValuation {
  const period = periodAt(terms, date);
  if (!period) return { nominal: terms.nominal, accruedInterest: 0, rate: 0, problem: "no_period" };
  return valueIn(terms, period, date, inputs);
}

/**
 * A listed bond's nominal and accrued interest on `date` as the market prices it: to the settlement day of a sale that
 * day (T+2, `settlementDate`), as GPW and Catalyst quote it and a buyer pays it. A coupon whose period ends by then
 * but isn't paid on `date` yet is added whole (whoever holds the bond on `date` gets it), so the value doesn't dip in
 * the days before a coupon. After the last period (a sale would settle after maturity): the last coupon, nominal at
 * maturity.
 */
export function valueBondAtSettlement(terms: BondTerms, date: IsoDate, inputs: BondValuationInputs = {}): BondValuation & { settlementDate: IsoDate } {
  const settle = settlementDate(date);
  const ended = terms.periods.filter((p) => p.end <= settle && date < p.paymentDate);
  const settledIn = periodAt(terms, settle);
  const base = settledIn ? valueIn(terms, settledIn, settle, inputs) : ended.length ? valueIn(terms, ended.at(-1)!, ended.at(-1)!.end, inputs) : valueBond(terms, date, inputs);
  if (base.problem) return { ...base, settlementDate: settle };
  let accrued = settledIn ? base.accruedInterest : 0;
  for (const p of ended) {
    const c = valueIn(terms, p, p.end, { ...inputs, periodRate: p.rate });
    if (c.problem) return { ...c, settlementDate: settle };
    accrued += c.accruedInterest;
  }
  return { ...base, accruedInterest: round2(accrued), settlementDate: settle };
}

/** Nominal and accrued interest in `period` on `date` (`period.end` gives the whole coupon). */
function valueIn(terms: BondTerms, period: CouponPeriod, date: IsoDate, inputs: BondValuationInputs): BondValuation {

  const rate = period.rate ?? (terms.couponType === "FLOATING" ? inputs.periodRate : terms.couponRate);
  if (rate === undefined) return { nominal: terms.nominal, accruedInterest: 0, rate: 0, problem: "missing_coupon_rate" };

  const elapsed = daysBetween(period.start, date);
  const length = daysBetween(period.start, period.end);
  const yearFraction = elapsed / length;

  if (terms.couponType === "INDEXED") {
    const ratio =
      inputs.referenceIndex && terms.baseRef !== undefined
        ? indexRatioAt(inputs.referenceIndex, terms.baseRef, date)
        : undefined;
    if (ratio === undefined) {
      return { nominal: terms.nominal, accruedInterest: 0, rate, problem: "missing_reference_index" };
    }
    return {
      nominal: round2(terms.nominal * ratio),
      accruedInterest: round2(terms.nominal * rate * yearFraction * ratio),
      rate,
      indexRatio: ratio,
    };
  }

  return { nominal: terms.nominal, accruedInterest: round2(terms.nominal * rate * yearFraction), rate };
}

/** Market value per bond from a clean price in % of nominal. */
export function dirtyValue(cleanPricePct: number, valuation: BondValuation): number {
  return round2((cleanPricePct / 100) * valuation.nominal + valuation.accruedInterest);
}
