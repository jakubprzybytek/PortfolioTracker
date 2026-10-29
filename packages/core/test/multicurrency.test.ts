import { describe, expect, it } from "vitest";
import type { InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { accountSummaries, netDepositsByDate } from "../src/valuation/accounts.ts";
import { rateD1, rateOn, type FxHistory } from "../src/valuation/fx.ts";
import { positionKey, positionsAt } from "../src/valuation/positions.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";

// An account in EUR (IBKR): PLN sent and exchanged at the broker's rate, a bond bought and its fee paid in EUR,
// part exchanged to USD. PLN values of transactions at the NBP rate of the day before (D-1).

const BUND = "DE0001102523";
const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#IBKR", SK: "TX#", GSI1PK: "TX", GSI1SK: "", id: t.date + t.type, account: "IBKR", currency: "PLN", source: "t", ...t }) as TransactionItem;

const fx: FxHistory = new Map([
  [
    "EUR",
    [
      { date: "2025-12-31", mid: 4.32 },
      { date: "2026-01-02", mid: 4.3 }, // Friday
      { date: "2026-01-05", mid: 4.25 }, // Monday
      { date: "2026-01-06", mid: 4.2 },
      { date: "2026-10-12", mid: 4.4 },
    ],
  ],
  [
    "USD",
    [
      { date: "2026-01-05", mid: 3.7 },
      { date: "2026-10-12", mid: 3.9 },
    ],
  ],
]);

const txs = [
  tx({ date: "2026-01-02", type: "DEPOSIT", amount: 10000 }),
  // IBKR's rate 4.32 (NBP was 4.30): 8640 PLN for 2000 EUR
  tx({ date: "2026-01-02", type: "EXCHANGE", amount: -8640, toAmount: 2000, toCurrency: "EUR" }),
  // Monday: D-1 is Friday's 4.30 (the weekend has no rate)
  tx({ date: "2026-01-05", type: "BUY", isin: BUND, quantity: 1, price: 96.5, amount: -965, fee: 1.25, currency: "EUR" }),
  tx({ date: "2026-01-06", type: "EXCHANGE", amount: -300, fee: 1, currency: "EUR", toAmount: 345.5, toCurrency: "USD" }),
  tx({ date: "2026-01-07", type: "DEPOSIT", amount: 500, currency: "EUR" }),
];

describe("NBP rates", () => {
  it("D-1: the last business day strictly before; on a day: that day's or the last before", () => {
    expect(rateD1(fx, "EUR", "2026-01-05")).toBe(4.3); // Monday → Friday
    expect(rateD1(fx, "EUR", "2026-01-06")).toBe(4.25);
    expect(rateD1(fx, "EUR", "2025-12-31")).toBeUndefined(); // nothing before
    expect(rateD1(fx, "PLN", "2026-01-02")).toBe(1);
    expect(rateOn(fx, "EUR", "2026-01-06")).toEqual({ date: "2026-01-06", mid: 4.2 });
    expect(rateOn(fx, "EUR", "2026-01-04")).toEqual({ date: "2026-01-02", mid: 4.3 });
  });
});

describe("a bond bought in EUR", () => {
  it("costs in PLN at NBP D-1, and in EUR as paid", () => {
    const p = positionsAt(txs, "2026-10-12", fx).get(positionKey("IBKR", BUND))!;
    expect(p.cost).toBeCloseTo(4154.88, 1); // 966.25 EUR × 4.30
    expect(p.costNative).toEqual({ amount: 966.25, currency: "EUR" });
  });

  it("is valued at today's rate; cash per currency, each in PLN too", () => {
    const px = { isin: BUND, venue: "CALC", date: "2026-10-12", close: 98 } as PriceItem;
    const snap = valuePortfolio({
      date: "2026-10-12",
      instruments: [{ isin: BUND, code: BUND, name: "Bund", type: "BOND_IBKR", currency: "EUR", venue: "CALC", sourceIds: {}, active: true, nominal: 1000 } as unknown as InstrumentItem],
      transactions: txs,
      prices: new Map([[BUND, px]]),
      referenceIndex: new Map(),
      couponPeriods: new Map(),
      accounts: [{ account: "IBKR", baseCurrency: "EUR" }],
      fxHistory: fx,
    });
    expect(snap.holdings[0]!.cost).toBeCloseTo(4154.88, 1);
    expect(snap.holdings[0]).toMatchObject({ value: 4312, costNative: { amount: 966.25, currency: "EUR" }, fx: { rate: 4.4 } }); // 980 EUR × 4.40
    expect(snap.accounts!["IBKR"]).toEqual({
      cash: round2(1360 + 1232.75 * 4.4 + 345.5 * 3.9),
      currencies: {
        PLN: { amount: 1360, value: 1360 },
        EUR: { amount: 1232.75, value: 5424.1, rate: 4.4 }, // 2000 − 966.25 − 301 + 500
        USD: { amount: 345.5, value: 1347.45, rate: 3.9 },
      },
      baseCurrency: "EUR",
    });
  });
});

const round2 = (v: number) => Math.round(v * 100) / 100;

describe("the account summary", () => {
  it("counts deposits in another currency at NBP D-1; in its own currency, as made", () => {
    const snap = {
      date: "2026-10-12",
      holdings: [{ account: "IBKR", isin: BUND, value: 4312, quantity: 1 } as never],
      accounts: { IBKR: { cash: 8131.55, baseCurrency: "EUR" } },
    };
    const { accounts } = accountSummaries(snap, txs, fx);
    const ibkr = accounts[0]!;
    // 10000 PLN + 500 EUR at D-1 (2026-01-06: 4.20)
    expect(ibkr.netDeposits).toBe(12100);
    expect(ibkr.total).toBe(12443.55);
    expect(ibkr.costs).toBe(round2(1.25 * 4.3 + 1 * 4.25));
    // In EUR: 10000 PLN at D-1 4.32, the 500 EUR as made; the total at today's 4.40
    expect(ibkr.base).toMatchObject({ currency: "EUR", netDeposits: round2(10000 / 4.32 + 500), total: round2(12443.55 / 4.4) });
    expect(ibkr.base!.profit).toBeCloseTo(ibkr.base!.total - ibkr.base!.netDeposits, 2);
    expect(ibkr.base!.xirr).not.toBeNull();
  });
});

describe("net deposits per day (the portfolio chart's dashed line)", () => {
  it("adds deposits and withdrawals up to each day; another currency at NBP D-1; every account counts", () => {
    const more = [...txs, tx({ date: "2026-02-01", type: "WITHDRAWAL", amount: -1000 }), tx({ date: "2026-01-03", account: "other", type: "DEPOSIT", amount: 5000 })];
    const by = netDepositsByDate(more, ["2026-01-01", "2026-01-02", "2026-01-07", "2026-03-01"], fx);
    expect(Object.fromEntries(by)).toEqual({
      "2026-01-01": 0,
      "2026-01-02": 10000,
      "2026-01-07": 17100, // + 5000 in "other" + 500 EUR at 4.20 (D-1 of 2026-01-07)
      "2026-03-01": 16100,
    });
  });
});
