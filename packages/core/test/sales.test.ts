import { describe, expect, it } from "vitest";
import type { InstrumentItem, TransactionItem } from "../src/db/items.ts";
import { positionsAt } from "../src/valuation/positions.ts";
import { pitYears, salesOf } from "../src/valuation/sales.ts";

const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "date" | "type" | "amount">): TransactionItem =>
  ({ PK: "ACCT#a", SK: `TX#${t.date}#${t.id ?? "x"}`, GSI1PK: "TX", GSI1SK: `${t.date}#${t.id ?? "x"}`, id: "x", account: "a", currency: "PLN", source: "test", ...t }) as TransactionItem;
const inst = (isin: string, code: string, type: InstrumentItem["type"] = "BOND_CORPORATE") => ({ isin, code, name: `${code} name`, type, currency: "PLN" }) as InstrumentItem;

const instruments = [inst("PLAAAAAAAAA1", "AAA"), inst("PLBBBBBBBBB2", "BBB"), inst("PLRETAIL0001", "EDO0130", "BOND_RETAIL"), inst("XXEUR0000000", "EUR", "CURRENCY")];
const txs = [
  // Two buys, one sale of 100 across both (60 + 40), the remaining 10 redeemed the next year.
  tx({ id: "1", date: "2023-03-10", type: "BUY", isin: "PLAAAAAAAAA1", quantity: 60, amount: -5900, fee: 10 }),
  tx({ id: "2", date: "2024-06-02", type: "BUY", isin: "PLAAAAAAAAA1", quantity: 50, amount: -5060 }),
  tx({ id: "3", date: "2025-05-15", type: "SELL", isin: "PLAAAAAAAAA1", quantity: 100, amount: 10300 }),
  tx({ id: "4", date: "2026-01-20", type: "REDEMPTION", isin: "PLAAAAAAAAA1", quantity: 10, amount: 1000 }),
  // In an IKE: in the list, not in PIT-38.
  tx({ id: "5", account: "IKE Broker", date: "2024-01-05", type: "BUY", isin: "PLAAAAAAAAA1", quantity: 5, amount: -500 }),
  tx({ id: "6", account: "IKE Broker", date: "2025-02-05", type: "SELL", isin: "PLAAAAAAAAA1", quantity: 5, amount: 520 }),
  // Written off, a retail bond redeemed (taxed at source), foreign cash exchanged back: none in PIT-38.
  tx({ id: "7", date: "2024-02-01", type: "BUY", isin: "PLBBBBBBBBB2", quantity: 3, amount: -300 }),
  tx({ id: "8", date: "2025-08-01", type: "WRITE_OFF", isin: "PLBBBBBBBBB2", quantity: 3, amount: 0 }),
  tx({ id: "9", date: "2024-02-01", type: "BUY", isin: "PLRETAIL0001", quantity: 10, amount: -1000 }),
  tx({ id: "10", date: "2025-09-01", type: "REDEMPTION", isin: "PLRETAIL0001", quantity: 10, amount: 1080 }),
  tx({ id: "11", date: "2025-03-01", type: "BUY", isin: "XXEUR0000000", quantity: 100, amount: -430 }),
  tx({ id: "12", date: "2025-04-01", type: "SELL", isin: "XXEUR0000000", quantity: 100, amount: 440 }),
];

describe("sales", () => {
  const sales = salesOf(positionsAt(txs, "2026-10-20").values(), instruments);

  it("lists every disposal newest first, foreign cash left out", () => {
    expect(sales.map((s) => `${s.date} ${s.type} ${s.code}`)).toEqual([
      "2026-01-20 REDEMPTION AAA",
      "2025-09-01 REDEMPTION EDO0130",
      "2025-08-01 WRITE_OFF BBB",
      "2025-05-15 SELL AAA",
      "2025-02-05 SELL AAA",
    ]);
  });

  it("splits a sale into its FIFO pairs: cost per buy (fee included), proceeds by units, days held", () => {
    const sale = sales.find((s) => s.id === "3")!;
    expect(sale).toMatchObject({ quantity: 100, proceeds: 10300, cost: 9958, gain: 342, gainPct: 3.43, pit: true });
    expect(sale.pairs).toEqual([
      { buyDate: "2023-03-10", quantity: 60, cost: 5910, proceeds: 6180, gain: 270, days: 797 },
      { buyDate: "2024-06-02", quantity: 40, cost: 4048, proceeds: 4120, gain: 72, days: 347 },
    ]);
    expect(sales.find((s) => s.id === "4")!.pairs).toEqual([{ buyDate: "2024-06-02", quantity: 10, cost: 1012, proceeds: 1000, gain: -12, days: 597 }]);
  });

  it("pairs add up to the sale to the grosz", () => {
    const odd = salesOf(
      positionsAt(
        [
          tx({ id: "1", date: "2024-01-01", type: "BUY", isin: "PLAAAAAAAAA1", quantity: 3, amount: -100 }),
          tx({ id: "2", date: "2024-01-02", type: "BUY", isin: "PLAAAAAAAAA1", quantity: 3, amount: -100 }),
          tx({ id: "3", date: "2024-02-01", type: "SELL", isin: "PLAAAAAAAAA1", quantity: 5, amount: 200 }),
        ],
        "2024-12-31",
      ).values(),
      instruments,
    )[0]!;
    expect(odd.pairs.reduce((s, p) => s + p.cost, 0)).toBeCloseTo(odd.cost, 9);
    expect(odd.pairs.reduce((s, p) => s + p.proceeds, 0)).toBeCloseTo(odd.proceeds, 9);
  });

  it("says why a disposal stays out of PIT-38", () => {
    expect(Object.fromEntries(sales.map((s) => [s.id, s.notPit ?? null]))).toEqual({ "3": null, "4": null, "6": "IKE/IKZE", "8": "write-off", "10": "retail bond, taxed at source" });
  });

  it("sums PIT-38 per year: sales and redemptions outside IKE/IKZE", () => {
    expect(pitYears(sales)).toEqual([
      { year: 2026, count: 1, proceeds: 1000, cost: 1012, gain: -12 },
      { year: 2025, count: 1, proceeds: 10300, cost: 9958, gain: 342 },
    ]);
  });
});
