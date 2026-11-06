// Yield to maturity of a bond from its future cash flows: the flows of one bond (coupons from interest periods, or
// yearly coupons, and the nominal at maturity) and the annual rate that prices them. Used by Buy, hold or sell and by
// the Catalyst module's screen.

import { couponPerBond, type InterestPeriod } from "./couponPeriods.ts";
import { daysBetween, type IsoDate } from "../dates.ts";

/** Years between two dates, as yields count them here (365.25 days a year). */
export const yearsBetween = (a: IsoDate, b: IsoDate) => daysBetween(a, b) / 365.25;

/** A flow of one bond: its amount and the part of it that's taxed. */
export interface BondFlow {
  date: IsoDate;
  kind: "coupon" | "interest" | "redemption";
  perBond: number;
  taxBase: number;
  /** The amount rests on an assumption (a projected rate or index), not a known one. */
  projected?: boolean;
}

/** The annual rate at which `flows` (t in years) are worth `price` today; bisection, as flows are all positive. */
export function irr(price: number, flows: { t: number; amount: number }[]): number {
  if (price <= 0 || flows.length === 0) return 0;
  const pv = (y: number) => flows.reduce((s, f) => s + f.amount / (1 + y) ** f.t, 0);
  let lo = -0.99;
  let hi = 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > price) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 1e6) / 1e6;
}

/**
 * The flows of one bond paying a coupon per interest period (ACT/365 on `nominal`), from the periods ending after
 * `settle`, and the nominal on the last period's payment day. A period without a rate takes `rateWhenUnset(period)`
 * (e.g. an assumed WIBOR + margin), marked projected; undefined there makes the bond unprojectable (the reason is
 * returned instead).
 */
export function periodFlows(
  nominal: number,
  periods: InterestPeriod[],
  settle: IsoDate,
  rateWhenUnset: (p: InterestPeriod) => number | undefined,
): { flows: BondFlow[]; maturity: IsoDate } | string {
  if (periods.length === 0) return "no coupon periods (the instrument's settings)";
  const sorted = [...periods].sort((x, y) => x.start.localeCompare(y.start));
  const flows: BondFlow[] = [];
  for (const p of sorted) {
    if (p.end <= settle) continue;
    const rate = p.rate ?? rateWhenUnset(p);
    if (rate === undefined) return `no rate for the period from ${p.start}`;
    const coupon = couponPerBond(nominal, { ...p, rate })!;
    flows.push({ date: p.paymentDate, kind: "coupon", perBond: coupon, taxBase: coupon, ...(p.rate === undefined ? { projected: true } : {}) });
  }
  const maturity = sorted.at(-1)!.paymentDate;
  flows.push({ date: maturity, kind: "redemption", perBond: nominal, taxBase: 0 });
  return { flows, maturity };
}

/** The flows of one bond paying `coupon` (a fraction of `nominal`) yearly on its maturity's day, after `today`. */
export function yearlyCouponFlows(nominal: number, coupon: number, maturity: IsoDate, today: IsoDate): BondFlow[] {
  const flows: BondFlow[] = [];
  if (coupon > 0)
    for (let y = Number(maturity.slice(0, 4)); ; y--) {
      const d = `${y}${maturity.slice(4)}`;
      if (d <= today) break;
      flows.unshift({ date: d, kind: "coupon", perBond: nominal * coupon, taxBase: nominal * coupon });
    }
  flows.push({ date: maturity, kind: "redemption", perBond: nominal, taxBase: 0 });
  return flows;
}
