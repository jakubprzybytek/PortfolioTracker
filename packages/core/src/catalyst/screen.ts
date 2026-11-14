// One row of the Catalyst bond screen (Docs/catalyst.md, "Market metrics"): a listed bond's last price, its yield to
// maturity before and after tax, against the retail bond on offer (the alternative), its premium over the State's
// curve, and its liquidity. The yield follows "Buy, hold or sell" (core/holdsell): the same flows, the accrued
// interest paid counted against the first coupon's tax, the gain over the price paid taxed at maturity.

import { z } from "zod";
import type { InterestPeriod } from "../bonds/couponPeriods.ts";
import { INTEREST_TAX } from "../bonds/couponPeriods.ts";
import { irr, periodFlows, yearlyCouponFlows, yearsBetween, type BondFlow } from "../bonds/yield.ts";
import { addDays, type IsoDate } from "../dates.ts";
import { DEFAULT_ASSUMPTIONS, DEFAULT_COMMISSION, nbpRateFromOffers, nearestOffer, retailOfferYield, type HoldSellAssumptions } from "../holdsell/holdSell.ts";
import type { RetailTerms } from "../mf/retailRates.ts";
import { settlementDate } from "../settlement.ts";
import { curveAt, priceAdjustedMargin, type CurvePoint } from "./curve.ts";
import type { CatalystBondItem, CatalystQuoteItem, CatalystSessionItem, CatalystTermsItem } from "./items.ts";
import { liquidity, type Liquidity } from "./liquidity.ts";

/** What the future rates are taken to be (annual fractions) and what a purchase costs: the screen's assumptions. */
export interface CatalystAssumptions extends HoldSellAssumptions {
  /** WIRON and POLSTR (overnight rates: the NZ series and newer floating bonds). */
  wiron: number;
  /** EURIBOR (EUR floating bonds). */
  euribor: number;
}

const rate = z.number().min(-0.05).max(0.5);
export const CatalystAssumptionsInput = z.object({
  cpi: rate,
  wibor: rate,
  nbpRate: rate,
  wiron: rate,
  euribor: rate,
  alternative: z.enum(["retail", "rate"]),
  altRate: rate.optional(),
  commission: z.number().min(0).max(0.05).optional(),
});

export const DEFAULT_CATALYST_ASSUMPTIONS: CatalystAssumptions = { ...DEFAULT_ASSUMPTIONS, wiron: 0.04, euribor: 0.02 };

/** Saved views of the bonds screen: a name and the view's URL parameters (filters, sort). */
export const CatalystViewsInput = z
  .array(z.object({ name: z.string().trim().min(1).max(60), params: z.record(z.string(), z.string().max(200)) }))
  .max(30);
export type CatalystViews = z.output<typeof CatalystViewsInput>;

/** The defaults on `offers`' day (the NBP rate and WIRON from the ROR on offer), with what was saved over them. */
export function catalystAssumptions(saved: Partial<CatalystAssumptions> | undefined, offers: RetailTerms[]): { defaults: CatalystAssumptions; assumptions: CatalystAssumptions } {
  const nbpRate = nbpRateFromOffers(offers);
  const defaults: CatalystAssumptions = { ...DEFAULT_CATALYST_ASSUMPTIONS, ...(nbpRate !== undefined ? { nbpRate, wiron: nbpRate } : {}) };
  return { defaults, assumptions: { ...defaults, ...saved } };
}

/** Under this many days to maturity no yield is shown (a few weeks' yield, annualised, says nothing). */
export const MATURES_SOON_DAYS = 90;
/** No trade in this many sessions: the price is stale (shown grey; no premium). */
export const STALE_SESSIONS = 30;

export type ScreenFlag = "stale" | "new-listing" | "no-terms" | "no-periods" | "periods-extended" | "amortising" | "matures-soon" | "indexed" | "callable" | "suspended" | "marked";

/** Fewer sessions than this since listing: the liquidity rests on too few days (CAV1030: 2 of 2 traded, 2026-11-06). */
export const NEW_LISTING_SESSIONS = 10;

/** A company's analysis in short, as the bond table shows it. */
export interface IssuerSignals {
  state: "scored" | "no-report" | "out-of-scope";
  ruleSet: string;
  /** The six dimensions in their fixed order: colour and trend arrow. */
  dimensions: { name: string; signal: "green" | "yellow" | "red" | "na"; arrow?: "up" | "flat" | "down" }[];
  confidence?: "high" | "medium" | "low";
  /** The latest year the scorecard rests on. */
  latestPeriodEnd?: string;
  /** The interim period the scorecard also rests on ("H1 2026"), and whether its flows are TTM. */
  interim?: { label: string; ttm: boolean };
}

export interface ScreenRow {
  isin: string;
  code: string;
  /** The latest session loaded, and the bond's market used (its GPW row when it has one). */
  date: IsoDate;
  market: string;
  /** Clean price, % of nominal (the session's close: the reference price on a day without trades). */
  price: number | null;
  /** The last session with a trade (null: none in the window). */
  lastTraded: IsoDate | null;
  accruedInterest: number | null;
  nominal: number | null;
  maturity: IsoDate | null;
  years: number | null;
  /** Before tax, after the commission. */
  yieldGross: number | null;
  /** After 19% tax and the commission. */
  yieldNet: number | null;
  /** The future coupons rest on an assumed base rate (floating bonds). */
  projected: boolean;
  alternative: { label: string; yieldNet: number } | null;
  /** yieldNet − the alternative's. */
  vsAlternative: number | null;
  /** Over the State's curve: fixed coupons, yield − the curve at the same maturity; floating, price-adjusted margin − WZ's. */
  premium: number | null;
  premiumBasis: "fixed-curve" | "wz" | null;
  liquidity: Liquidity;
  flags: ScreenFlag[];
  /** The issuer's signals (phase 2), copied by the metrics from its company's analysis for the table's filters. */
  issuer?: IssuerSignals;
}

export interface ScreenInput {
  bond: CatalystBondItem;
  terms?: CatalystTermsItem;
  coupons: InterestPeriod[];
  /** Up to 90 sessions, every market, oldest first. */
  sessions: CatalystSessionItem[];
  /** Up to 30 end-of-session quotes, every market, oldest first. */
  quotes: CatalystQuoteItem[];
  fixedCurve: CurvePoint[];
  wzCurve: CurvePoint[];
  offers: RetailTerms[];
  assumptions: CatalystAssumptions;
}

const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

/** The assumed base rate of a floating coupon ("WIBOR 3M", "WIRON 1M", "POLSTR 6M", "EURIBOR 6M"). */
function baseRate(base: string | undefined, a: CatalystAssumptions): number | undefined {
  if (!base) return undefined;
  if (/^WIBOR/.test(base)) return a.wibor;
  if (/^(WIRON|POLSTR|POLONIA)/.test(base)) return a.wiron;
  if (/^EURIBOR/.test(base)) return a.euribor;
  return undefined;
}

/** `date` plus `months` calendar months, the day kept (or the month's last day). */
function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * The periods up to maturity: obligacje.pl sometimes lists them only up to the current one (ARH0227, 2026-11-06), so
 * the missing ones repeat the last period's length (in months), the last ending at maturity, without a rate (the
 * coupon rule gives it). Returns whether any were added.
 */
export function periodsToMaturity(periods: InterestPeriod[], maturity: IsoDate): { periods: InterestPeriod[]; extended: boolean } {
  const sorted = [...periods].sort((x, y) => x.start.localeCompare(y.start));
  const last = sorted.at(-1);
  if (!last || last.end >= addDays(maturity, -7)) return { periods: sorted, extended: false };
  const [ys, ms] = last.start.split("-").map(Number) as [number, number];
  const [ye, me] = last.end.split("-").map(Number) as [number, number];
  const months = Math.max(1, Math.round((ye * 12 + me - (ys * 12 + ms))));
  const out = [...sorted];
  for (let start = last.end; start < addDays(maturity, -7); ) {
    const next = addMonths(start, months);
    const end = next >= addDays(maturity, -7) ? maturity : next;
    out.push({ isin: last.isin, start, end, paymentDate: end, datesSource: last.datesSource });
    start = end;
  }
  return { periods: out, extended: true };
}

/** The bond's flows from settlement: from its interest periods (terms), or for treasury fixed and zero series yearly. */
function flowsOf(input: Pick<ScreenInput, "bond" | "terms" | "coupons" | "assumptions">, nominal: number, settle: IsoDate, fileRate: number | null): { flows: BondFlow[]; floating: boolean; extended?: boolean } | ScreenFlag {
  const { bond, terms, assumptions: a } = input;
  if (/^IZ\d{4}$/.test(bond.code)) return "indexed";
  if (bond.segment === "treasury" && /^(DS|PS|WS|OK)\d{4}$/.test(bond.code) && bond.maturity) return { flows: yearlyCouponFlows(nominal, fileRate ?? 0, bond.maturity, settle), floating: false };
  if (!terms || terms.notFound) return "no-terms";
  if (input.coupons.length === 0) return "no-periods";
  const { periods: coupons, extended } = bond.maturity ? periodsToMaturity(input.coupons, bond.maturity) : { periods: input.coupons, extended: false };
  const c = terms.coupon;
  if (c.kind === "ZERO") return { flows: [{ date: bond.maturity ?? coupons.at(-1)!.paymentDate, kind: "redemption", perBond: nominal, taxBase: 0 }], floating: false };
  if (c.kind === "FIXED") {
    const r = periodFlows(nominal, coupons, settle, () => c.rate ?? fileRate ?? undefined);
    return typeof r === "string" ? "no-periods" : { flows: r.flows, floating: false, extended };
  }
  if (c.kind === "FLOATING") {
    const base = baseRate(c.base, a);
    const r = periodFlows(nominal, coupons, settle, () => (base === undefined ? undefined : base + (c.margin ?? 0)));
    return typeof r === "string" ? "no-periods" : { flows: r.flows, floating: true, extended };
  }
  return "no-terms";
}

export function screenRow(input: ScreenInput): ScreenRow {
  const { bond, terms, assumptions: a } = input;
  const market = bond.markets.find((m) => m.startsWith("GPW")) ?? bond.markets[0] ?? "";
  const sessions = input.sessions.filter((s) => s.market === market);
  const last = sessions.at(-1);
  const lastTraded = [...sessions].reverse().find((s) => s.trades > 0)?.date ?? null;
  const liq = liquidity(sessions, input.quotes.filter((q) => q.market === market));
  const flags: ScreenFlag[] = [];
  const stale = sessions.slice(-STALE_SESSIONS).every((s) => s.trades === 0);
  if (stale) flags.push("stale");
  // Every listed bond has a session a day (traded or not): fewer in the window means a recent listing.
  if (sessions.length < NEW_LISTING_SESSIONS) flags.push("new-listing");
  if (terms?.issueValue && bond.nominal !== null && bond.nominal < terms.issueValue.nominal) flags.push("amortising");

  const base: ScreenRow = {
    isin: bond.isin,
    code: bond.code,
    date: last?.date ?? bond.lastSeen,
    market,
    price: last?.close ?? null,
    lastTraded,
    accruedInterest: last?.accruedInterest ?? null,
    nominal: last?.nominal ?? bond.nominal,
    maturity: bond.maturity,
    years: null,
    yieldGross: null,
    yieldNet: null,
    projected: false,
    alternative: null,
    vsAlternative: null,
    premium: null,
    premiumBasis: null,
    liquidity: liq,
    flags,
  };
  if (!last || last.close === null || !bond.maturity || !base.nominal) return base;

  const settle = settlementDate(last.date);
  const years = yearsBetween(settle, bond.maturity);
  base.years = round(years, 4);
  if (bond.maturity <= addDays(settle, MATURES_SOON_DAYS)) {
    flags.push("matures-soon");
    return base;
  }

  const nominal = base.nominal;
  const got = flowsOf(input, nominal, settle, last.rate);
  // The premium: the same as the history's (sessionPremium), not on a stale price.
  if (!stale) {
    const p = sessionPremium({ bond, terms, coupons: input.coupons, session: { date: last.date, close: last.close, accruedInterest: last.accruedInterest, nominal, rate: last.rate }, fixedCurve: input.fixedCurve, wzCurve: input.wzCurve });
    if (p) {
      base.premium = p.premium;
      base.premiumBasis = p.basis;
    }
  }
  if (typeof got === "string") {
    flags.push(got);
    return base;
  }
  // Nothing left to receive after settlement (the periods end before it): no yield rather than a meaningless one.
  if (!got.flows.some((f) => f.date > settle && f.kind === "redemption")) {
    flags.push("no-periods");
    return base;
  }
  if (got.extended) flags.push("periods-extended");

  const accrued = last.accruedInterest ?? 0;
  const price = (nominal * last.close) / 100 + accrued;
  const commission = a.commission ?? DEFAULT_COMMISSION;
  const cost = price * (1 + commission);
  // Tax: coupons less the accrued interest paid with the bond (deductible from the first), and the gain over the
  // price paid at redemption.
  let accruedLeft = accrued;
  const flows = got.flows.filter((f) => f.date > settle).map((f) => {
    let taxBase = f.taxBase;
    if (f.kind !== "redemption" && accruedLeft > 0) {
      const used = Math.min(accruedLeft, taxBase);
      taxBase -= used;
      accruedLeft -= used;
    }
    if (f.kind === "redemption") taxBase = Math.max(0, f.perBond - cost);
    return { t: yearsBetween(settle, f.date), gross: f.perBond, net: f.perBond - Math.max(0, taxBase) * INTEREST_TAX };
  });
  base.yieldGross = irr(cost, flows.map((f) => ({ t: f.t, amount: f.gross })));
  base.yieldNet = irr(cost, flows.map((f) => ({ t: f.t, amount: f.net })));
  base.projected = got.floating || !!got.extended;

  if (bond.currency === "PLN") {
    if (a.alternative === "rate" && a.altRate !== undefined) base.alternative = { label: `${(a.altRate * 100).toFixed(2)}% (your rate)`, yieldNet: round(a.altRate * (1 - INTEREST_TAX)) };
    else {
      const offer = nearestOffer(input.offers, years);
      if (offer) base.alternative = { label: `${offer.series} (retail, ${offer.termMonths >= 12 ? `${offer.termMonths / 12} y` : `${offer.termMonths} m`})`, yieldNet: retailOfferYield(offer, settle, bond.maturity, false, a) };
    }
    if (base.alternative) base.vsAlternative = round(base.yieldNet - base.alternative.yieldNet);
  }
  return base;
}

/** A session of a bond as its premium needs it. */
export interface PremiumSession {
  date: IsoDate;
  /** Clean price, % of nominal. */
  close: number | null;
  accruedInterest: number | null;
  nominal: number | null;
  /** The current period's rate in the daily file (fixed treasury series' coupon). */
  rate: number | null;
}

/**
 * A bond's premium over the State on a session (Docs/catalyst.md, "Market metrics"; the premium history and today's
 * screen alike): a floating coupon, its margin adjusted for the price less the WZ curve's at the same years; a fixed
 * one, its yield before tax and commission less the fixed curve's. PLN only; none within 90 days of maturity, for an
 * indexed bond, or without terms or periods.
 */
export function sessionPremium(input: { bond: CatalystBondItem; terms?: CatalystTermsItem; coupons: InterestPeriod[]; session: PremiumSession; fixedCurve: CurvePoint[]; wzCurve: CurvePoint[] }): { premium: number; basis: "wz" | "fixed-curve" } | null {
  const { bond, terms, session: s } = input;
  const nominal = s.nominal ?? bond.nominal;
  if (bond.currency !== "PLN" || s.close === null || !bond.maturity || !nominal) return null;
  const settle = settlementDate(s.date);
  if (bond.maturity <= addDays(settle, MATURES_SOON_DAYS)) return null;
  const years = yearsBetween(settle, bond.maturity);
  // A floating coupon needs only its margin, not its flows.
  const coupon = terms?.coupon;
  if (coupon?.kind === "FLOATING" && coupon.margin !== undefined) {
    const wz = curveAt(input.wzCurve, years);
    return { premium: round(priceAdjustedMargin(coupon.margin, s.close, years) - (wz ?? 0)), basis: "wz" };
  }
  const got = flowsOf({ bond, terms, coupons: input.coupons, assumptions: DEFAULT_CATALYST_ASSUMPTIONS }, nominal, settle, s.rate);
  if (typeof got === "string" || got.floating || !got.flows.some((f) => f.date > settle && f.kind === "redemption")) return null;
  const curve = curveAt(input.fixedCurve, years);
  if (curve === null) return null;
  const price = (nominal * s.close) / 100 + (s.accruedInterest ?? 0);
  const flows = got.flows.filter((f) => f.date > settle).map((f) => ({ t: yearsBetween(settle, f.date), amount: f.perBond }));
  return { premium: round(irr(price, flows) - curve), basis: "fixed-curve" };
}
