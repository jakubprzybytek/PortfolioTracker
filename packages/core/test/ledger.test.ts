import { describe, expect, it } from "vitest";
import type { InstrumentItem, TransactionItem } from "../src/db/items.ts";
import { addDays, type IsoDate } from "../src/dates.ts";
import { cashByAccount } from "../src/valuation/cash.ts";
import type { FxHistory } from "../src/valuation/fx.ts";
import { Ledger } from "../src/valuation/ledger.ts";
import { positionsAt } from "../src/valuation/positions.ts";
import { retailLotsAt } from "../src/valuation/retailLots.ts";
import { valuePortfolio } from "../src/valuation/valuePortfolio.ts";

// Walking forward must give, for every day, exactly what replaying all transactions up to that day gives.

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#", SK: "TX#", GSI1PK: "TX", GSI1SK: "", id: `${t.date}-${t.type}-${t.isin ?? ""}`, account: "A", currency: "PLN", source: "t", ...t }) as TransactionItem;

const fx: FxHistory = new Map([["EUR", [{ date: "2026-01-01", mid: 4.3 }, { date: "2026-01-08", mid: 4.25 }]]]);

// Given out of date order, as a table query can return them.
const txs = [
  tx({ date: "2026-01-09", type: "SELL", isin: "PL0000000001", quantity: 15, amount: 1700, fee: 2 }),
  tx({ date: "2026-01-02", type: "DEPOSIT", amount: 20000 }),
  tx({ date: "2026-01-03", type: "BUY", isin: "PL0000000001", quantity: 10, amount: -1000, fee: 1 }),
  tx({ date: "2026-01-05", type: "BUY", isin: "PL0000000001", quantity: 10, amount: -1100, fee: 1 }),
  tx({ date: "2026-01-06", type: "COUPON", isin: "PL0000000001", amount: 12.34 }),
  tx({ date: "2026-01-06", type: "SPLIT", isin: "PL0000000001", amount: 0, ratio: 2 }),
  tx({ date: "2026-01-04", type: "BUY", isin: "PL0000000002", quantity: 50, amount: -5000, valueDate: "2026-01-04" }),
  tx({ date: "2026-01-07", type: "BUY", isin: "PL0000000002", quantity: 20, amount: -2000, valueDate: "2026-01-07" }),
  tx({ date: "2026-01-10", type: "REDEMPTION", isin: "PL0000000002", quantity: 60, amount: 6100 }),
  tx({ date: "2026-01-04", type: "EXCHANGE", amount: -4300, toAmount: 1000, toCurrency: "EUR" }),
  tx({ date: "2026-01-08", type: "BUY", account: "B", isin: "DE0000000003", quantity: 2, amount: -500, fee: 1.5, currency: "EUR" }),
  tx({ date: "2026-01-08", type: "SELL", account: "B", isin: "DE0000000003", quantity: 1, amount: 260, currency: "EUR" }),
  tx({ date: "2026-01-11", type: "WRITE_OFF", account: "B", isin: "DE0000000003", quantity: 1, amount: 0 }),
  tx({ date: "2026-01-11", type: "FEE", amount: -5 }),
];

const days = (from: IsoDate, to: IsoDate) => {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

describe("Ledger", () => {
  it("positions, cash and retail lots on each day equal a replay up to that day", () => {
    const ledger = new Ledger(txs, fx);
    for (const date of days("2026-01-01", "2026-01-12")) {
      ledger.advanceTo(date);
      expect(ledger.positions(), date).toEqual(positionsAt(txs, date, fx));
      expect(ledger.cashByAccount(), date).toEqual(cashByAccount(txs, date));
      for (const [account, isin] of [["A", "PL0000000002"], ["B", "DE0000000003"]] as const)
        expect(ledger.retailLots(account, isin), date).toEqual(retailLotsAt(txs.filter((t) => t.account === account && t.isin === isin), date));
    }
  });

  it("what it returned doesn't change as it goes on, and it doesn't go back", () => {
    const ledger = new Ledger(txs, fx).advanceTo("2026-01-05");
    const positions = ledger.positions();
    const copy = structuredClone(positions);
    ledger.advanceTo("2026-01-12");
    expect(positions).toEqual(copy);
    expect(() => ledger.advanceTo("2026-01-11")).toThrow();
  });

  it("valuing day after day with one ledger gives the same snapshots as without", () => {
    const instruments = [
      { isin: "PL0000000001", code: "AAA", name: "A", type: "SHARE", currency: "PLN", venue: "GPW", sourceIds: {} },
      { isin: "DE0000000003", code: "BBB", name: "B", type: "ETF", currency: "EUR", venue: "XETRA", sourceIds: {} },
    ] as unknown as InstrumentItem[];
    const base = { instruments, transactions: txs, prices: new Map(), referenceIndex: new Map(), couponPeriods: new Map(), fxHistory: fx };
    const ledger = new Ledger(txs, fx);
    for (const date of days("2026-01-01", "2026-01-12")) {
      const { computedAt: _a, ...walked } = valuePortfolio({ ...base, date, ledger });
      const { computedAt: _b, ...replayed } = valuePortfolio({ ...base, date });
      expect(walked, date).toEqual(replayed);
    }
  });
});
