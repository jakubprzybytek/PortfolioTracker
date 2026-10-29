import { describe, expect, it } from "vitest";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { parseTransactionFile } from "../src/transactions/schema.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";

const KRU = "PLKRK0000713";

describe("corporate bonds", () => {
  const inst: InstrumentItem = {
    PK: `INST#${KRU}`, SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: KRU, isin: KRU, code: "KRU0827", name: "Kruk S.A.", type: "BOND_CORPORATE",
    currency: "PLN", venue: "CATALYST", sourceIds: { biznesradar: "KRU0827" }, active: true, nominal: 100, updatedAt: "",
  };
  const price: PriceItem = {
    PK: `INST#${KRU}`, SK: "PX#CATALYST#2026-10-09", isin: KRU, venue: "CATALYST", date: "2026-10-09", open: null, high: null, low: null, close: 100.45,
    volume: 520, trades: 0, turnover: 0, traded: true, currency: "PLN", source: "biznesradar", fetchedAt: "", status: "final",
  };
  const buy = { PK: "ACCT#a", SK: "TX#2026-03-03#1", GSI1PK: "TX", GSI1SK: "2026-03-03#1", id: "1", account: "a", date: "2026-03-03", type: "BUY", isin: KRU, quantity: 40, price: 101.2, amount: -4048, fee: 8.1, currency: "PLN", source: "t" } as TransactionItem;

  it("without coupon periods: the clean price (% of nominal) × nominal, flagged", () => {
    const snap = valuePortfolio({ date: "2026-10-12", instruments: [inst], transactions: [buy], prices: new Map([[KRU, price]]), referenceIndex: new Map(), couponPeriods: new Map() });
    expect(snap.holdings[0]).toMatchObject({ type: "BOND_CORPORATE", quantity: 40, cleanPrice: 100.45, nominal: 100, accruedInterest: null, valuePerUnit: 100.45, value: 4018, cost: 4056.1, flags: ["no_coupon_rate"], noCouponRate: { from: null } });
  });

  it("with the period's rate: clean value plus accrued interest", () => {
    const period = { isin: KRU, start: "2026-08-12", end: "2026-11-12", recordDate: "2026-11-03", paymentDate: "2026-11-12", datesSource: "obligacje.pl" as const, rate: 0.0713 };
    const snap = valuePortfolio({ date: "2026-10-12", instruments: [inst], transactions: [buy], prices: new Map([[KRU, price]]), referenceIndex: new Map(), couponPeriods: new Map([[KRU, [period]]]) });
    // To the settlement day (Monday 2026-10-12 → Wednesday 10-14, T+2): 63 days of 7.13 % on 100, 1.23 per bond.
    expect(snap.holdings[0]).toMatchObject({ accruedInterest: 1.23, valuePerUnit: 101.68, value: 4067.2, flags: [], rate: { current: 0.0713, previous: null } });
    expect(snap.holdings[0]!.noCouponRate).toBeUndefined();
  });

  it("a sale settling on the record day or later keeps the whole coupon", () => {
    const period = { isin: KRU, start: "2026-08-12", end: "2026-11-12", recordDate: "2026-11-03", paymentDate: "2026-11-12", datesSource: "obligacje.pl" as const, rate: 0.0713 };
    // Friday 2026-10-30 settles on Tuesday 11-03, the record day: the whole coupon, 92 days of 7.13 % on 100 = 1.80
    const snap = valuePortfolio({ date: "2026-10-30", instruments: [inst], transactions: [buy], prices: new Map([[KRU, price]]), referenceIndex: new Map(), couponPeriods: new Map([[KRU, [period]]]) });
    expect(snap.holdings[0]).toMatchObject({ accruedInterest: 1.8 });
  });

});
