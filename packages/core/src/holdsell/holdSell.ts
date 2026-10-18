// Hold or sell a bond (Docs/ui.md, "Hold or sell"): is a bond worth more kept to maturity, or sold today with the
// money put into an alternative (by default the retail treasury bond on offer with the nearest term) until that day?
// What was paid doesn't matter, only what the bond still pays from today against what selling it brings today.
//
// Per position: the cash flows still to come (coupons, the nominal at maturity), each after tax, and the net amount a
// sale (or an early redemption) brings today. Future rates come from assumptions: a flat CPI (IZ, EDO, COI, ROD …), a
// flat WIBOR (floating corporates) and a flat NBP reference rate (ROR, DOR). Both sides grow at the alternative's
// after-tax yield to the bond's maturity; the difference there is the answer.

import { z } from "zod";
import { couponOf } from "../bonds/accrued.ts";
import { couponPerBond, INTEREST_TAX, isTaxFreeAccount, type InterestPeriod } from "../bonds/couponPeriods.ts";
import { indexRatioAt, type ReferenceIndex } from "../bonds/izIndex.ts";
import { grosz, lotSeries, publishedRatePeriods, valueRetailBond, type RetailRatePeriod } from "../bonds/retail.ts";
import type { BondTerms } from "../bonds/terms.ts";
import { daysBetween, shiftMonth, type IsoDate } from "../dates.ts";
import type { HoldingSnapshot, InstrumentItem, TransactionItem } from "../db/items.ts";
import type { RetailKind, RetailTerms } from "../mf/retailRates.ts";
import { settlementDate } from "../settlement.ts";
import { retailLotsAt } from "../valuation/retailLots.ts";

/** What the future rates are taken to be (annual fractions), and what the money from a sale would go into. */
export interface HoldSellAssumptions {
  /** CPI y/y, flat (IZ indexation, EDO/COI/ROS/ROD periods after the first). */
  cpi: number;
  /** WIBOR (3M/6M alike), flat: floating corporate bonds (WIBOR + margin). */
  wibor: number;
  /** NBP reference rate, flat: ROR and DOR (reference rate + margin). */
  nbpRate: number;
  /** "retail": the retail bond on offer with the nearest term; "rate": `altRate` (before tax). */
  alternative: "retail" | "rate";
  altRate?: number;
  /** A sale's commission as a fraction of its value, for every account; absent: each account's own, from its trades. */
  commission?: number;
}

export const DEFAULT_ASSUMPTIONS: HoldSellAssumptions = { cpi: 0.025, wibor: 0.045, nbpRate: 0.04, alternative: "retail" };

const rateField = z.number().min(-0.05).max(0.5);
/** The assumptions as sent by the app (PUT /hold-sell/assumptions). */
export const HoldSellAssumptionsInput = z.object({
  cpi: rateField,
  wibor: rateField,
  nbpRate: rateField,
  alternative: z.enum(["retail", "rate"]),
  altRate: rateField.optional(),
  commission: z.number().min(0).max(0.05).optional(),
});

/** A broker's commission on bonds when an account has no trades with a fee to learn it from. */
export const DEFAULT_COMMISSION = 0.0019;
/** Below this difference in annual yield, neither side is worth the switch: "about the same". */
export const EVEN_BAND = 0.002;

export interface HoldFlow {
  date: IsoDate;
  kind: "coupon" | "interest" | "redemption";
  /** Before tax, for the whole position (PLN). */
  amount: number;
  tax: number;
  /** The amount came from an assumption (a projected rate or index), not a known one. */
  projected?: boolean;
}

export interface SellNow {
  /** What the position is worth today (price + accrued interest; retail: nominal + interest). */
  value: number;
  commission: number;
  /** Retail bonds: the Ministry's early-redemption fee. */
  fee: number;
  tax: number;
  net: number;
}

export interface Alternative {
  label: string;
  /** The retail series, when the alternative is one. */
  series?: string;
  /** After tax (none in IKE/IKZE), annual. */
  yield: number;
}

export interface HoldSellRow {
  account: string;
  isin: string;
  code: string;
  name: string;
  type: InstrumentItem["type"];
  quantity: number;
  maturity: IsoDate;
  years: number;
  taxFree: boolean;
  /** The commission rate used for a sale. */
  commissionRate: number;
  sellNow: SellNow;
  flows: HoldFlow[];
  /** Annual yield of giving up `sellNow.net` today for the flows (after tax). */
  yieldIfHeld: number;
  alternative: Alternative;
  /** Both sides at maturity, growing at the alternative's yield: kept (flows reinvested) vs sold today. */
  holdAtMaturity: number;
  sellAtMaturity: number;
  /** holdAtMaturity − sellAtMaturity: above 0 keeping pays more. */
  difference: number;
  verdict: "HOLD" | "SELL" | "EVEN";
  /** What the result rests on: the assumptions that were used. */
  notes: string[];
}

export interface HoldSellSkipped {
  account: string;
  isin: string;
  code: string;
  reason: string;
}

export interface HoldSellInput {
  today: IsoDate;
  holdings: HoldingSnapshot[];
  instruments: ReadonlyMap<string, InstrumentItem>;
  transactions: TransactionItem[];
  /** Corporate bonds' interest periods. */
  couponPeriods: ReadonlyMap<string, InterestPeriod[]>;
  referenceIndex: ReferenceIndex;
  /** Retail series on sale today (the alternative). */
  offers: RetailTerms[];
  assumptions: HoldSellAssumptions;
}

const BOND_TYPES = new Set(["BOND_LISTED", "BOND_CORPORATE", "BOND_RETAIL", "BOND_IBKR"]);
const yearsBetween = (a: IsoDate, b: IsoDate) => daysBetween(a, b) / 365.25;
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (x: number) => `${(x * 100).toFixed(2).replace(".", ",")} %`;

// --- retail bonds -----------------------------------------------------------------------------------

/** Retail series offered to everyone, with their terms in months: the alternatives (ROS, ROD: families on 800+ only; OTS isn't in the Ministry file). */
export const RETAIL_OFFER_TERMS: { kind: RetailKind; months: number }[] = [
  { kind: "ROR", months: 12 },
  { kind: "DOR", months: 24 },
  { kind: "TOS", months: 36 },
  { kind: "COI", months: 48 },
  { kind: "EDO", months: 120 },
];

/** The series code sold in `month` ("YYYY-MM"): the kind and its maturity month, e.g. EDO1036 in 2026-10. */
export function offerSeriesCode(kind: RetailKind, months: number, month: string): string {
  const m = shiftMonth(month, months);
  return `${kind}${m.slice(5, 7)}${m.slice(2, 4)}`;
}

/**
 * The Ministry's fee for redeeming one bond early (PLN). Raised for series sold from September 2024 (TOS 0,70 → 1,
 * COI 0,70 → 2, EDO 2 → 3). TOS, EDO, ROS and ROD never take more than the interest earned; ROR, DOR and COI only in
 * their first interest period.
 */
export function earlyRedemptionFee(kind: RetailKind, saleStart: IsoDate, interest: number, firstPeriod: boolean): number {
  const raised = saleStart >= "2024-09-01";
  const fee: Record<RetailKind, number> = { ROR: 0.5, DOR: 0.7, TOS: raised ? 1 : 0.7, COI: raised ? 2 : 0.7, EDO: raised ? 3 : 2, ROS: raised ? 1 : 0.7, ROD: raised ? 3 : 2 };
  const capped = kind === "TOS" || kind === "EDO" || kind === "ROS" || kind === "ROD" || firstPeriod;
  return capped ? Math.min(fee[kind], Math.max(0, interest)) : fee[kind];
}

/** A series' periods with the published rates, and an assumed rate for those not published yet. */
function projectedPeriods(terms: RetailTerms, valueDate: IsoDate, a: HoldSellAssumptions): { periods: RetailRatePeriod[]; projected: Set<RetailRatePeriod> } {
  const series = lotSeries(terms, valueDate);
  const projected = new Set<RetailRatePeriod>();
  const periods = publishedRatePeriods(series, terms.rates).map((p) => {
    if (p.basis !== "unknown") return p;
    const margin = terms.margin ?? 0;
    const rate = terms.kind === "ROR" || terms.kind === "DOR" ? a.nbpRate + margin : terms.margin === undefined ? (terms.rates[0] ?? p.rate) : Math.max(a.cpi, 0) + margin;
    const q = { ...p, rate };
    projected.add(q);
    return q;
  });
  return { periods, projected };
}

/** A flow of one bond: its amount and the part of it that's taxed. */
interface BondFlow {
  date: IsoDate;
  kind: HoldFlow["kind"];
  perBond: number;
  taxBase: number;
  projected?: boolean;
}

interface PerBond {
  flows: BondFlow[];
  sell: { value: number; fee: number; taxBase: number };
  maturity: IsoDate;
}

/** One retail bond bought on `valueDate`: what it still pays from `today`, and what redeeming it today brings. */
function retailBond(terms: RetailTerms, valueDate: IsoDate, today: IsoDate, a: HoldSellAssumptions, redeemOn?: IsoDate): PerBond {
  const series = lotSeries(terms, valueDate);
  const { periods, projected } = projectedPeriods(terms, valueDate, a);
  const months = series.periodMonths ?? 12;
  const flows: PerBond["flows"] = [];
  const end = redeemOn && redeemOn < series.maturity ? redeemOn : series.maturity;
  if (series.capitalises) {
    const v = valueRetailBond(series, periods, end);
    flows.push({ date: end, kind: "redemption", perBond: v.value, taxBase: v.value - 100, projected: periods.some((p) => projected.has(p) && p.start < end) });
  } else {
    for (const p of periods) {
      if (p.end <= today || p.end > end) continue;
      const interest = grosz(100 * p.rate * (months / 12));
      flows.push({ date: p.end, kind: "interest", perBond: interest, taxBase: interest, ...(projected.has(p) ? { projected: true } : {}) });
    }
    if (end < series.maturity) {
      const v = valueRetailBond(series, periods, end);
      flows.push({ date: end, kind: "interest", perBond: v.accrued, taxBase: v.accrued });
    }
    flows.push({ date: end, kind: "redemption", perBond: 100, taxBase: 0 });
  }
  // Redeemed before maturity (today, or at `redeemOn`): the fee comes off the last flow.
  const sell = valueRetailBond(series, periods, today);
  const interestNow = sell.value - 100;
  const firstPeriod = periods[0] ? today < periods[0].end : true;
  const fee = earlyRedemptionFee(terms.kind, terms.saleStart, interestNow, firstPeriod);
  if (end < series.maturity) {
    const at = valueRetailBond(series, periods, end);
    const feeThen = earlyRedemptionFee(terms.kind, terms.saleStart, at.value - 100, periods[0] ? end < periods[0].end : true);
    const last = flows.at(-1)!;
    last.perBond -= feeThen;
    if (series.capitalises) last.taxBase -= feeThen;
    else flows.at(-2)!.taxBase = Math.max(0, flows.at(-2)!.taxBase - feeThen);
  }
  return { flows, sell: { value: sell.value, fee, taxBase: Math.max(0, interestNow - fee) }, maturity: series.maturity };
}

/**
 * The annual after-tax yield of the alternative over `years` (from today): one bond of the series bought today, held
 * to its maturity (then the same again) or redeemed early at the horizon, with its fee.
 */
export function retailOfferYield(terms: RetailTerms, today: IsoDate, horizon: IsoDate, taxFree: boolean, a: HoldSellAssumptions): number {
  const b = retailBond(terms, today, today, a, horizon);
  const tax = taxFree ? 0 : INTEREST_TAX;
  const flows = b.flows.map((f) => ({ t: yearsBetween(today, f.date), amount: f.perBond - Math.max(0, f.taxBase) * tax }));
  return irr(100, flows);
}

// --- listed treasury, corporate and IBKR bonds -----------------------------------------------------------

/** The reference index carried on past its last month at the assumed CPI (for IZ coupons and redemption). */
export function extendReferenceIndex(index: ReferenceIndex, to: IsoDate, cpi: number): ReferenceIndex {
  const months = [...index.keys()].sort();
  const last = months.at(-1);
  if (!last) return index;
  const out = new Map(index);
  const monthly = (1 + cpi) ** (1 / 12);
  let w = index.get(last)!;
  for (let m = shiftMonth(last, 1); m <= to.slice(0, 7); m = shiftMonth(m, 1)) {
    w *= monthly;
    out.set(m, Math.round(w * 1e5) / 1e5);
  }
  return out;
}

function listedBond(terms: BondTerms, today: IsoDate, index: ReferenceIndex, a: HoldSellAssumptions): { flows: PerBond["flows"]; maturity: IsoDate } | string {
  const settle = settlementDate(today);
  const known = [...index.keys()].sort().at(-1);
  const ext = terms.couponType === "INDEXED" ? extendReferenceIndex(index, shiftMonth(terms.maturity.slice(0, 7), 3) + "-01", a.cpi) : index;
  const flows: PerBond["flows"] = [];
  for (const p of terms.periods) {
    if (p.end <= settle) continue;
    const c = couponOf(terms, p, { referenceIndex: ext });
    if (c.problem) return `no coupon for the period from ${p.start} (${c.problem})`;
    // IZ: the index of a period's end rests on CPI 2–3 months before it; past the last published month it's assumed.
    const projected = terms.couponType === "INDEXED" && !!known && shiftMonth(p.end.slice(0, 7), -2) > known;
    flows.push({ date: p.paymentDate, kind: "coupon", perBond: c.accruedInterest, taxBase: c.accruedInterest, ...(projected ? { projected } : {}) });
  }
  let nominal = terms.nominal;
  if (terms.couponType === "INDEXED" && terms.baseRef !== undefined) {
    const ratio = indexRatioAt(ext, terms.baseRef, terms.maturity);
    if (ratio !== undefined) nominal = Math.max(terms.nominal, round(terms.nominal * ratio));
  }
  flows.push({ date: terms.maturity, kind: "redemption", perBond: nominal, taxBase: 0, ...(terms.couponType === "INDEXED" ? { projected: true } : {}) });
  return { flows, maturity: terms.maturity };
}

/** The margin over WIBOR in a floating bond's name ("Kruk S.A. (WIBOR 3M + 3.3%)"), as a fraction. */
export function wiborMargin(name: string): number | undefined {
  const m = /WIBOR\s*\d+M\s*\+\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(name);
  return m ? Number(m[1]!.replace(",", ".")) / 100 : undefined;
}

function corporateBond(inst: InstrumentItem, periods: InterestPeriod[], today: IsoDate, a: HoldSellAssumptions): { flows: PerBond["flows"]; maturity: IsoDate; floating: boolean } | string {
  if (!inst.nominal) return "no nominal";
  if (periods.length === 0) return "no coupon periods (the instrument's settings)";
  const sorted = [...periods].sort((x, y) => x.start.localeCompare(y.start));
  const settle = settlementDate(today);
  const margin = wiborMargin(inst.name);
  const lastRate = [...sorted].reverse().find((p) => p.rate !== undefined)?.rate;
  const flows: PerBond["flows"] = [];
  for (const p of sorted) {
    if (p.end <= settle) continue;
    const rate = p.rate ?? (margin !== undefined ? a.wibor + margin : lastRate);
    if (rate === undefined) return `no rate for the period from ${p.start}`;
    const coupon = couponPerBond(inst.nominal, { ...p, rate })!;
    flows.push({ date: p.paymentDate, kind: "coupon", perBond: coupon, taxBase: coupon, ...(p.rate === undefined ? { projected: true } : {}) });
  }
  const maturity = sorted.at(-1)!.paymentDate;
  flows.push({ date: maturity, kind: "redemption", perBond: inst.nominal, taxBase: 0 });
  return { flows, maturity, floating: margin !== undefined };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** An IBKR bond's coupon and maturity from its name ("DE Govt 0.0 Nov15'27"), or the maturity from its price path. */
export function ibkrTerms(inst: Pick<InstrumentItem, "name" | "pricePath">): { coupon: number; maturity: IsoDate } | undefined {
  const m = /(\d+(?:\.\d+)?)\s+([A-Z][a-z]{2})(\d{1,2})'(\d{2})/.exec(inst.name);
  const fromName = m && MONTHS.includes(m[2]!) ? `20${m[4]}-${String(MONTHS.indexOf(m[2]!) + 1).padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : undefined;
  const fromPath = inst.pricePath?.filter((p) => p.price === 100).at(-1)?.date;
  const maturity = fromName ?? fromPath;
  return maturity ? { coupon: m ? Number(m[1]) / 100 : 0, maturity } : undefined;
}

function ibkrBond(inst: InstrumentItem, today: IsoDate): { flows: PerBond["flows"]; maturity: IsoDate } | string {
  const t = ibkrTerms(inst);
  if (!t) return "maturity unknown";
  const nominal = inst.nominal ?? 1000;
  const flows: PerBond["flows"] = [];
  // Yearly coupons on the maturity's day.
  if (t.coupon > 0)
    for (let y = Number(t.maturity.slice(0, 4)); ; y--) {
      const d = `${y}${t.maturity.slice(4)}`;
      if (d <= today) break;
      flows.unshift({ date: d, kind: "coupon", perBond: nominal * t.coupon, taxBase: nominal * t.coupon });
    }
  flows.push({ date: t.maturity, kind: "redemption", perBond: nominal, taxBase: 0 });
  return { flows, maturity: t.maturity };
}

// --- the comparison -------------------------------------------------------------------------------------

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

/** An account's commission on bond trades: the median fee / amount of its bond trades with a fee, else the default. */
export function commissionRate(transactions: TransactionItem[], account: string, bondIsins: ReadonlySet<string>): number {
  const rates = transactions
    .filter((t) => t.account === account && (t.type === "BUY" || t.type === "SELL") && t.isin && bondIsins.has(t.isin) && t.fee && t.amount)
    .map((t) => t.fee! / Math.abs(t.amount))
    .sort((a, b) => a - b);
  return rates.length ? Math.round(rates[Math.floor(rates.length / 2)]! * 1e5) / 1e5 : DEFAULT_COMMISSION;
}

/** The retail series on offer with the term nearest to `years`. */
export function nearestOffer(offers: RetailTerms[], years: number): RetailTerms | undefined {
  return [...offers].sort((a, b) => Math.abs(a.termMonths / 12 - years) - Math.abs(b.termMonths / 12 - years) || a.termMonths - b.termMonths)[0];
}

/** Every bond position: kept to maturity vs sold today, with the flows and the assumptions behind the result. */
export function holdOrSell(input: HoldSellInput): { rows: HoldSellRow[]; skipped: HoldSellSkipped[] } {
  const { today, assumptions: a } = input;
  const rows: HoldSellRow[] = [];
  const skipped: HoldSellSkipped[] = [];
  const bondIsins = new Set([...input.instruments.values()].filter((i) => BOND_TYPES.has(i.type)).map((i) => i.isin));

  for (const h of input.holdings) {
    if (!BOND_TYPES.has(h.type) || h.quantity <= 0) continue;
    const inst = input.instruments.get(h.isin);
    const skip = (reason: string) => skipped.push({ account: h.account, isin: h.isin, code: h.code, reason });
    if (!inst) {
      skip("unknown instrument");
      continue;
    }
    const taxFree = isTaxFreeAccount(h.account);
    const tax = taxFree ? 0 : INTEREST_TAX;
    const notes: string[] = [];
    const commission = a.commission ?? commissionRate(input.transactions, h.account, bondIsins);
    let flows: HoldFlow[];
    let sellNow: SellNow;
    let maturity: IsoDate;

    if (h.type === "BOND_RETAIL") {
      if (!inst.retail) {
        skip("no terms (Ministry file)");
        continue;
      }
      const lots = retailLotsAt(
        input.transactions.filter((t) => t.account === h.account && t.isin === h.isin),
        today,
      );
      const byDate = new Map<string, HoldFlow>();
      let value = 0;
      let fee = 0;
      let taxNow = 0;
      maturity = today;
      for (const lot of lots) {
        const b = retailBond(inst.retail, lot.valueDate, today, a);
        if (b.maturity > maturity) maturity = b.maturity;
        for (const f of b.flows) {
          const key = `${f.date}#${f.kind}`;
          const was = byDate.get(key) ?? { date: f.date, kind: f.kind, amount: 0, tax: 0 };
          was.amount += f.perBond * lot.quantity;
          was.tax += Math.max(0, f.taxBase) * tax * lot.quantity;
          if (f.projected) was.projected = true;
          byDate.set(key, was);
        }
        value += b.sell.value * lot.quantity;
        fee += b.sell.fee * lot.quantity;
        taxNow += b.sell.taxBase * tax * lot.quantity;
      }
      flows = [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date) || (x.kind === "redemption" ? 1 : -1));
      sellNow = { value: round(value), commission: 0, fee: round(fee), tax: round(taxNow), net: round(value - fee - taxNow) };
      notes.push("sold = redeemed early at the Ministry: nominal + interest − its fee");
      if (flows.some((f) => f.projected)) notes.push(inst.retail.kind === "ROR" || inst.retail.kind === "DOR" ? `later rates: NBP rate ${pct(a.nbpRate)} + margin` : `later rates: CPI ${pct(a.cpi)} + margin`);
    } else {
      const per =
        h.type === "BOND_LISTED" && inst.terms
          ? listedBond(inst.terms, today, input.referenceIndex, a)
          : h.type === "BOND_CORPORATE"
            ? corporateBond(inst, input.couponPeriods.get(h.isin) ?? [], today, a)
            : h.type === "BOND_IBKR"
              ? ibkrBond(inst, today)
              : "no terms";
      if (typeof per === "string") {
        skip(per);
        continue;
      }
      if (h.value === null) {
        skip("no price today");
        continue;
      }
      // IBKR bonds in their currency: at today's rate throughout.
      const fx = h.type === "BOND_IBKR" ? (h.fx?.rate ?? 1) : 1;
      maturity = per.maturity;
      flows = per.flows.map((f) => ({ date: f.date, kind: f.kind, amount: round(f.perBond * h.quantity * fx), tax: round(f.taxBase * h.quantity * fx * tax), ...(f.projected ? { projected: true } : {}) }));
      // The gain over cost is taxed at maturity (the redemption) when kept, today when sold.
      const redemption = flows.at(-1)!;
      redemption.tax = round(Math.max(0, redemption.amount - h.cost) * tax);
      const c = round(h.value * commission);
      const taxNow = round(Math.max(0, h.value - c - h.cost) * tax);
      sellNow = { value: h.value, commission: c, fee: 0, tax: taxNow, net: round(h.value - c - taxNow) };
      notes.push(`sale: ${pct(commission)} commission${a.commission === undefined ? " (the account's, from its trades)" : ""}`);
      if (h.type === "BOND_LISTED" && inst.terms?.couponType === "INDEXED") notes.push(`IZ indexation at CPI ${pct(a.cpi)} from the last published month`);
      if ("floating" in per && per.floating && flows.some((f) => f.projected)) notes.push(`coupons not set yet: WIBOR ${pct(a.wibor)} + margin`);
      else if (flows.some((f) => f.projected) && h.type === "BOND_CORPORATE") notes.push("coupons not set yet: the last known rate");
      if (h.type === "BOND_IBKR") notes.push(`in ${h.currency} at today's rate (${h.fx?.rate ?? "?"}); against an alternative in PLN the exchange rate's moves aren't counted`);
    }
    if (maturity <= today || flows.length === 0) {
      skip("matured");
      continue;
    }
    if (!taxFree) notes.push("tax 19 % on interest and on the gain over cost");
    else notes.push("no tax (IKE/IKZE)");

    const years = yearsBetween(today, maturity);
    let alternative: Alternative;
    if (a.alternative === "rate" || input.offers.length === 0) {
      const r = (a.altRate ?? a.nbpRate) * (1 - tax);
      alternative = { label: `${pct(a.altRate ?? a.nbpRate)} a year${taxFree ? "" : " before tax"}`, yield: round(r, 6) };
      if (a.alternative === "retail") notes.push("no retail bond on offer found: the rate instead");
    } else {
      const offer = nearestOffer(input.offers, years)!;
      alternative = { label: `${offer.series} (retail, ${offer.termMonths >= 12 ? `${offer.termMonths / 12} y` : `${offer.termMonths} m`})`, series: offer.series, yield: retailOfferYield(offer, today, maturity, taxFree, a) };
    }

    const net = flows.map((f) => ({ t: yearsBetween(today, f.date), amount: f.amount - f.tax }));
    const yieldIfHeld = irr(sellNow.net, net);
    const grow = (amount: number, t: number) => amount * (1 + alternative.yield) ** (years - t);
    const holdAtMaturity = round(net.reduce((s, f) => s + grow(f.amount, f.t), 0));
    const sellAtMaturity = round(grow(sellNow.net, 0));
    const difference = round(holdAtMaturity - sellAtMaturity);
    const verdict = Math.abs(yieldIfHeld - alternative.yield) < EVEN_BAND ? "EVEN" : difference > 0 ? "HOLD" : "SELL";
    rows.push({
      account: h.account,
      isin: h.isin,
      code: h.code,
      name: h.name,
      type: h.type,
      quantity: h.quantity,
      maturity,
      years: round(years, 2),
      taxFree,
      commissionRate: h.type === "BOND_RETAIL" ? 0 : commission,
      sellNow,
      flows: flows.map((f) => ({ ...f, amount: round(f.amount), tax: round(f.tax) })),
      yieldIfHeld,
      alternative,
      holdAtMaturity,
      sellAtMaturity,
      difference,
      verdict,
      notes,
    });
  }
  return { rows: rows.sort((x, y) => x.difference - y.difference), skipped };
}
