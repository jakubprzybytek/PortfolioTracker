import { describe, expect, it } from "vitest";
import type { BondTerms } from "../src/bonds/terms.ts";
import type { HoldingSnapshot, InstrumentItem, TransactionItem } from "../src/db/items.ts";
import {
  commissionRate,
  DEFAULT_ASSUMPTIONS,
  earlyRedemptionFee,
  extendReferenceIndex,
  buyMore,
  holdOrSell,
  ibkrTerms,
  irr,
  nearestOffer,
  offerSeriesCode,
  retailOfferYield,
  wiborMargin,
  type HoldSellInput,
} from "../src/holdsell/holdSell.ts";
import type { RetailTerms } from "../src/mf/retailRates.ts";

const TODAY = "2026-10-18";

const holding = (h: Partial<HoldingSnapshot>): HoldingSnapshot =>
  ({ account: "Broker", isin: "PL0000000001", code: "DS0000", name: "DS", type: "BOND_LISTED", currency: "PLN", quantity: 10, cleanPrice: 100, priceDate: TODAY, nominal: 1000, accruedInterest: 0, valuePerUnit: 1000, value: 10_000, cost: 10_000, couponsReceived: 0, gain: 0, gainPct: 0, flags: [], ...h }) as HoldingSnapshot;
const instrument = (i: Partial<InstrumentItem>): InstrumentItem =>
  ({ PK: "INST#x", SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: "x", isin: "PL0000000001", code: "DS0000", name: "DS", type: "BOND_LISTED", currency: "PLN", venue: "XWAR", sourceIds: {}, active: true, live: false, updatedAt: "", ...i }) as InstrumentItem;

/** A fixed 5 % bond with yearly coupons on 25 October, maturing 2028-10-25. */
const fixedTerms: BondTerms = {
  isin: "PL0000000001",
  code: "DS1028",
  nominal: 1000,
  currency: "PLN",
  couponType: "FIXED",
  couponRate: 0.05,
  maturity: "2028-10-25",
  periods: [
    { start: "2025-10-25", end: "2026-10-25", paymentDate: "2026-10-25" },
    { start: "2026-10-25", end: "2027-10-25", paymentDate: "2027-10-25" },
    { start: "2027-10-25", end: "2028-10-25", paymentDate: "2028-10-25" },
  ],
};

const tos = (series: string, saleStart: string, rate: number): RetailTerms => ({
  series,
  isin: `PL0000${series}00`,
  kind: "TOS",
  termMonths: 36,
  periodMonths: 12,
  capitalises: true,
  rates: [rate, rate, rate],
  publishedInterest: [],
  saleStart,
  saleEnd: saleStart.slice(0, 8) + "28",
});

const base = (over: Partial<HoldSellInput>): HoldSellInput => ({
  today: TODAY,
  holdings: [],
  instruments: new Map(),
  transactions: [],
  couponPeriods: new Map(),
  referenceIndex: new Map(),
  offers: [],
  assumptions: DEFAULT_ASSUMPTIONS,
  ...over,
});

describe("helpers", () => {
  it("irr: the annual rate that prices the flows", () => {
    expect(irr(100, [{ t: 1, amount: 110 }])).toBeCloseTo(0.1, 5);
    expect(irr(100, [{ t: 0.5, amount: 5 }, { t: 1, amount: 105 }])).toBeCloseTo(0.1025, 3);
  });

  it("offerSeriesCode: the kind and its maturity month", () => {
    expect(offerSeriesCode("EDO", 120, "2026-10")).toBe("EDO1036");
    expect(offerSeriesCode("TOS", 36, "2026-10")).toBe("TOS1029");
    expect(offerSeriesCode("ROR", 12, "2026-12")).toBe("ROR1227");
  });

  it("earlyRedemptionFee: higher for series sold from September 2024; capped by the interest where the rules say so", () => {
    expect(earlyRedemptionFee("EDO", "2025-01-01", 10, false)).toBe(3);
    expect(earlyRedemptionFee("EDO", "2025-01-01", 1.2, false)).toBe(1.2);
    expect(earlyRedemptionFee("EDO", "2023-01-01", 10, false)).toBe(2);
    expect(earlyRedemptionFee("COI", "2023-01-01", 0.1, false)).toBe(0.7); // after the first period: the whole fee
    expect(earlyRedemptionFee("COI", "2025-01-01", 0.5, true)).toBe(0.5);
    expect(earlyRedemptionFee("TOS", "2025-01-01", 4, false)).toBe(1);
  });

  it("reads a floating bond's margin and an IBKR bond's coupon and maturity from their names", () => {
    expect(wiborMargin("Kruk S.A. (WIBOR 3M + 3.3%)")).toBeCloseTo(0.033, 6);
    expect(wiborMargin("Fixed 7,5 %")).toBeUndefined();
    expect(ibkrTerms({ name: "DE Govt 0.0 Nov15'27 (sample holding)" })).toEqual({ coupon: 0, maturity: "2027-11-15" });
    expect(ibkrTerms({ name: "FR Govt 2.5 May24'30" })).toEqual({ coupon: 0.025, maturity: "2030-05-24" });
    expect(ibkrTerms({ name: "Some bill", pricePath: [{ date: "2026-01-01", price: 97 }, { date: "2027-03-01", price: 100 }] })).toEqual({ coupon: 0, maturity: "2027-03-01" });
  });

  it("carries the reference index on at the assumed CPI", () => {
    const ext = extendReferenceIndex(new Map([["2026-08", 200]]), "2026-11-30", 0.12);
    expect(ext.get("2026-09")).toBeCloseTo(200 * 1.12 ** (1 / 12), 4);
    expect(ext.get("2026-11")).toBeCloseTo(200 * 1.12 ** (3 / 12), 3);
  });

  it("commissionRate: the median of the account's bond trades, else the default", () => {
    const tx = (fee: number, amount: number, account = "Broker") => ({ account, type: "BUY", isin: "PL0000000001", fee, amount }) as TransactionItem;
    expect(commissionRate([tx(2, -1000), tx(3, -1000), tx(10, -1000), tx(1, -1000, "Other")], "Broker", new Set(["PL0000000001"]))).toBe(0.003);
    expect(commissionRate([], "Broker", new Set())).toBe(0.0019);
  });

  it("nearestOffer: the term nearest the years left", () => {
    const offers = [tos("TOS1029", "2026-10-01", 0.05), { ...tos("EDO1036", "2026-10-01", 0.056), kind: "EDO" as const, termMonths: 120 }, { ...tos("ROR1027", "2026-10-01", 0.04), kind: "ROR" as const, termMonths: 12 }];
    expect(nearestOffer(offers, 2.6)!.series).toBe("TOS1029");
    expect(nearestOffer(offers, 8)!.series).toBe("EDO1036");
    expect(nearestOffer(offers, 0.4)!.series).toBe("ROR1027");
  });

  it("retailOfferYield: a TOS at 5 % held 3 years is 5 % before tax, ~4,1 % after; redeemed after a year the fee comes off", () => {
    const offer = tos("TOS1029", "2026-10-01", 0.05);
    expect(retailOfferYield(offer, TODAY, "2029-10-18", true, DEFAULT_ASSUMPTIONS)).toBeCloseTo(0.05, 3);
    const taxed = retailOfferYield(offer, TODAY, "2029-10-18", false, DEFAULT_ASSUMPTIONS);
    expect(taxed).toBeGreaterThan(0.04);
    expect(taxed).toBeLessThan(0.042);
    expect(retailOfferYield(offer, TODAY, "2027-10-18", true, DEFAULT_ASSUMPTIONS)).toBeCloseTo(0.04, 2); // 5 zł interest − 1 zł fee
  });
});

describe("holdOrSell", () => {
  const listed = (price: number, account = "IKE Broker") =>
    base({
      // value = clean price + accrued interest to the settlement day (T+2: 2026-10-20, 360 days into the period)
      holdings: [holding({ account, code: "DS1028", cleanPrice: price, value: Math.round(10 * (price * 10 + (50 * 360) / 365) * 100) / 100, cost: price * 10 * 10 })],
      instruments: new Map([["PL0000000001", instrument({ code: "DS1028", terms: fixedTerms })]]),
      assumptions: { ...DEFAULT_ASSUMPTIONS, alternative: "rate", altRate: 0.05, commission: 0 },
    });

  it("a fixed bond at par paying what the alternative pays: about the same", () => {
    const { rows, skipped } = holdOrSell(listed(100));
    expect(skipped).toEqual([]);
    const [r] = rows;
    expect(r).toMatchObject({ code: "DS1028", maturity: "2028-10-25", taxFree: true, verdict: "EVEN" });
    expect(r!.flows.map((f) => [f.date, f.kind, f.amount])).toEqual([
      ["2026-10-25", "coupon", 500],
      ["2027-10-25", "coupon", 500],
      ["2028-10-25", "coupon", 500],
      ["2028-10-25", "redemption", 10000],
    ]);
    expect(r!.alternative.yield).toBeCloseTo(0.05, 6);
  });

  it("the same bond at 90 % yields more than 5 % kept: hold; and at 110 %: sell", () => {
    const cheap = holdOrSell(listed(90)).rows[0]!;
    expect(cheap.verdict).toBe("HOLD");
    expect(cheap.yieldIfHeld).toBeGreaterThan(0.1);
    expect(cheap.difference).toBeGreaterThan(0);
    const dear = holdOrSell(listed(110)).rows[0]!;
    expect(dear.verdict).toBe("SELL");
    expect(dear.difference).toBeLessThan(0);
    expect(dear.holdAtMaturity - dear.sellAtMaturity).toBeCloseTo(dear.difference, 1);
  });

  it("outside IKE: 19 % on coupons and on the gain over cost; a sale pays commission and the tax due now", () => {
    const input = listed(100, "Broker");
    input.holdings[0]!.cost = 9000; // bought at 90
    input.assumptions = { ...input.assumptions, commission: 0.002 };
    const r = holdOrSell(input).rows[0]!;
    expect(r.taxFree).toBe(false);
    expect(r.flows[0]!.tax).toBe(95); // 19 % of 500
    expect(r.flows.at(-1)!.tax).toBe(190); // 19 % of 10 000 − 9 000
    expect(r.sellNow).toEqual({ value: 10493.15, commission: 20.99, fee: 0, tax: 279.71, net: 10192.45 });
    expect(r.alternative.yield).toBeCloseTo(0.05 * 0.81, 6);
  });

  it("a retail TOS bought at 6 % against a TOS on offer at 5 %: hold; selling = early redemption with its fee", () => {
    const terms = tos("TOS0127", "2024-01-01", 0.06);
    const input = base({
      holdings: [holding({ account: "IKE Obligacje", isin: terms.isin, code: "TOS0127", type: "BOND_RETAIL", value: 1180 })],
      instruments: new Map([[terms.isin, instrument({ isin: terms.isin, code: "TOS0127", type: "BOND_RETAIL", retail: terms })]]),
      transactions: [{ id: "1", account: "IKE Obligacje", date: "2024-01-15", type: "BUY", isin: terms.isin, quantity: 10, price: 100, amount: -1000, currency: "PLN" } as TransactionItem],
      offers: [tos("TOS1029", "2026-10-01", 0.05)],
    });
    const r = holdOrSell(input).rows[0]!;
    expect(r.maturity).toBe("2027-01-15");
    expect(r.flows).toEqual([{ date: "2027-01-15", kind: "redemption", amount: 1191, tax: 0 }]);
    expect(r.sellNow.fee).toBe(7); // 0,70 per bond (sold before September 2024)
    expect(r.alternative).toMatchObject({ series: "TOS1029" });
    expect(r.verdict).toBe("HOLD");
  });

  it("skips what it can't project and says why", () => {
    const { rows, skipped } = holdOrSell(
      base({
        holdings: [holding({ type: "BOND_CORPORATE", code: "XYZ0128" }), holding({ type: "ETF", code: "SPXS" })],
        instruments: new Map([["PL0000000001", instrument({ type: "BOND_CORPORATE", nominal: 1000 })]]),
      }),
    );
    expect(rows).toEqual([]);
    expect(skipped).toEqual([{ account: "Broker", isin: "PL0000000001", code: "XYZ0128", reason: "no coupon periods (the instrument's settings)" }]);
  });
});

describe("buyMore", () => {
  // One more DS1028 (fixed 5 %, yearly coupon on 25 October, matures 2028-10-25) at `price` %, plus accrued interest to T+2.
  const accrued = Math.round(((50 * 360) / 365) * 100) / 100;
  const listed = (price: number, account = "IKE Broker") =>
    base({
      holdings: [holding({ account, code: "DS1028", cleanPrice: price, accruedInterest: accrued, valuePerUnit: price * 10 + accrued, value: 10 * (price * 10 + accrued) })],
      instruments: new Map([["PL0000000001", instrument({ code: "DS1028", terms: fixedTerms })]]),
      offers: [tos("TOS1029", "2026-10-01", 0.05)],
      assumptions: { ...DEFAULT_ASSUMPTIONS, cpi: 0.025, commission: 0 },
    });

  it("at par in IKE: about the coupon before and after tax, real after CPI, duration about two years, over the retail bond on offer", () => {
    const [r] = buyMore({ ...listed(100), portfolioValue: 100_000 });
    expect(r).toMatchObject({ code: "DS1028", taxFree: true, maturity: "2028-10-25", price: { perBond: 1000 + accrued, commission: 0, currency: "PLN" } });
    expect(r!.grossYield!).toBeCloseTo(0.05, 2);
    expect(r!.netYield).toBe(r!.grossYield);
    expect(r!.realYield).toBeCloseTo((1 + r!.netYield) / 1.025 - 1, 6);
    // Macaulay ~1,88 years, modified = that / (1 + yield)
    expect(r!.duration!).toBeGreaterThan(1.75);
    expect(r!.duration!).toBeLessThan(1.85);
    expect(r!.alternative?.series).toBe("TOS1029");
    expect(r!.spread!).toBeCloseTo(r!.netYield - r!.alternative!.yield, 6);
    expect(r!.weight).toBeCloseTo(0.1049, 3);
  });

  it("outside IKE: 19 % tax, but not on the accrued interest paid with the bond; cheaper means a higher yield", () => {
    const r = buyMore(listed(100, "Broker"))[0]!;
    expect(r.taxFree).toBe(false);
    // About 5 % × 0,81: the first coupon (50) mostly gives back the accrued interest paid (49,32), which isn't taxed.
    expect(r.netYield).toBeGreaterThan(0.039);
    expect(r.netYield).toBeLessThan(0.0415);
    expect(r.netYield).toBeLessThan(r.grossYield!);
    expect(buyMore(listed(90))[0]!.grossYield!).toBeGreaterThan(0.1);
  });

  it("retail: one row per account and kind, the series on offer now, weighed with every series of that kind held", () => {
    const old1 = tos("TOS0127", "2024-01-01", 0.06);
    const old2 = tos("TOS0627", "2024-06-01", 0.06);
    const input = base({
      holdings: [
        holding({ account: "Retail", isin: old1.isin, code: "TOS0127", type: "BOND_RETAIL", value: 1000 }),
        holding({ account: "Retail", isin: old2.isin, code: "TOS0627", type: "BOND_RETAIL", value: 3000 }),
      ],
      instruments: new Map([
        [old1.isin, instrument({ isin: old1.isin, code: "TOS0127", type: "BOND_RETAIL", retail: old1 })],
        [old2.isin, instrument({ isin: old2.isin, code: "TOS0627", type: "BOND_RETAIL", retail: old2 })],
      ]),
      offers: [tos("TOS1029", "2026-10-01", 0.05)],
    });
    const rows = buyMore({ ...input, portfolioValue: 10_000 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "TOS1029", offerSeries: "TOS1029", grossYield: null, alternative: null, spread: null, duration: null, weight: 0.4 });
    expect(rows[0]!.netYield).toBeCloseTo(0.05 * 0.81, 3);
  });
});
