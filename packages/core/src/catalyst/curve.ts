// The treasury curves the Catalyst premiums are measured against (Docs/catalyst.md, "Market metrics"): the yield of
// the State's fixed-rate bonds by years to maturity (DS, PS, WS, OK), and the price-adjusted margin of its floating
// ones (WZ, margin 0) for floating corporate bonds. Both from the day's GPW closes in the daily file; no other source.

import type { IsoDate } from "../dates.ts";
import { settlementDate } from "../settlement.ts";
import { irr, yearlyCouponFlows, yearsBetween } from "../bonds/yield.ts";

export interface CurvePoint {
  years: number;
  /** Fixed curve: the yield to maturity; WZ curve: the price-adjusted margin. Fractions. */
  value: number;
  code: string;
}

/** A treasury bond's session as the curves need it (the GPW row of the daily file). */
export interface TreasuryQuote {
  code: string;
  maturity: IsoDate;
  /** Clean price, % of nominal. */
  close: number;
  /** The current period's rate (fraction); null for zero-coupon OK. */
  rate: number | null;
  accruedInterest: number;
  nominal: number;
}

/** Points nearer than this to maturity are left out (a few weeks' yield, annualised, is noise). */
const MIN_YEARS = 0.25;

const FIXED_SERIES = /^(DS|PS|WS|OK)\d{4}$/;
const WZ_SERIES = /^WZ\d{4}$/;

/** Yield to maturity before tax and commission: the clean price + accrued interest against coupons and the nominal. */
export function fixedYield(q: Pick<TreasuryQuote, "maturity" | "close" | "rate" | "accruedInterest" | "nominal">, settle: IsoDate): number {
  const flows = yearlyCouponFlows(q.nominal, q.rate ?? 0, q.maturity, settle);
  return irr((q.nominal * q.close) / 100 + q.accruedInterest, flows.map((f) => ({ t: yearsBetween(settle, f.date), amount: f.perBond })));
}

/** A floating bond's margin adjusted for its price: the margin, less the premium paid over par spread over its years. */
export function priceAdjustedMargin(margin: number, close: number, years: number): number {
  return margin + (1 - close / 100) / years;
}

/** The fixed-rate curve of a session (`date`): one point per DS/PS/WS/OK series, by years to maturity. */
export function fixedCurve(quotes: TreasuryQuote[], date: IsoDate): CurvePoint[] {
  const settle = settlementDate(date);
  return quotes
    .filter((q) => FIXED_SERIES.test(q.code) && yearsBetween(settle, q.maturity) >= MIN_YEARS)
    .map((q) => ({ years: round(yearsBetween(settle, q.maturity), 4), value: round(fixedYield(q, settle), 6), code: q.code }))
    .sort((a, b) => a.years - b.years);
}

/** The WZ curve of a session: their price-adjusted margins (their margin is 0, checked 2026-11-06) by years. */
export function wzCurve(quotes: TreasuryQuote[], date: IsoDate): CurvePoint[] {
  const settle = settlementDate(date);
  return quotes
    .filter((q) => WZ_SERIES.test(q.code) && yearsBetween(settle, q.maturity) >= MIN_YEARS)
    .map((q) => {
      const years = yearsBetween(settle, q.maturity);
      return { years: round(years, 4), value: round(priceAdjustedMargin(0, q.close, years), 6), code: q.code };
    })
    .sort((a, b) => a.years - b.years);
}

/** The curve's value at `years`: straight lines between points, flat beyond the first and the last; null without points. */
export function curveAt(points: CurvePoint[], years: number): number | null {
  if (points.length === 0) return null;
  if (years <= points[0]!.years) return points[0]!.value;
  const last = points.at(-1)!;
  if (years >= last.years) return last.value;
  const i = points.findIndex((p) => p.years >= years);
  const a = points[i - 1]!;
  const b = points[i]!;
  return round(a.value + ((b.value - a.value) * (years - a.years)) / (b.years - a.years), 6);
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
