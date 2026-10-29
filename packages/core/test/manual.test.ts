import { describe, expect, it } from "vitest";
import {
  checkManualTransaction,
  corporateInstrument,
  etfInstrument,
  listedTreasuryInstrument,
  ManualTransaction,
  manualInstrument,
  newTransactionId,
  retailInstrument,
} from "../src/transactions/manual.ts";

const DS = "PL0000113783";
const tx = (t: Record<string, unknown>) => ManualTransaction.parse({ date: "2026-10-13", account: "a", ...t });

describe("checkManualTransaction", () => {
  const known = new Set([DS]);

  it("accepts a buy of a known instrument and a deposit", () => {
    expect(checkManualTransaction(tx({ type: "BUY", isin: DS, quantity: 10, price: 81.2, amount: -8120, fee: 16.24 }), known)).toEqual([]);
    expect(checkManualTransaction(tx({ type: "DEPOSIT", amount: 1000 }), known)).toEqual([]);
  });

  it("needs an instrument, a quantity, a ratio where the type does", () => {
    expect(checkManualTransaction(tx({ type: "BUY", quantity: 1, amount: -10 }), known)).toContain("BUY needs an instrument");
    expect(checkManualTransaction(tx({ type: "SELL", isin: DS, amount: 10 }), known)).toContain("SELL needs a quantity");
    expect(checkManualTransaction(tx({ type: "SPLIT", isin: DS, amount: 0 }), known)).toContain("SPLIT needs a ratio");
    expect(checkManualTransaction(tx({ type: "BUY", isin: "PL0000999999", quantity: 1, amount: -10 }), known)).toEqual(["Unknown instrument PL0000999999: add it first"]);
  });

  it("checks the direction of the money and real dates", () => {
    expect(checkManualTransaction(tx({ type: "BUY", isin: DS, quantity: 1, amount: 10 }), known)).toEqual(["BUY: the amount is money out, so negative"]);
    expect(checkManualTransaction(tx({ type: "COUPON", isin: DS, amount: -5 }), known)).toEqual(["COUPON: the amount is money in, so positive"]);
    expect(checkManualTransaction(tx({ type: "DEPOSIT", amount: 1, date: "2026-02-30" }), known)).toEqual(["date: 2026-02-30 is not a date"]);
    expect(checkManualTransaction(tx({ type: "DEPOSIT", amount: 1, date: "2028-02-29" }), known)).toEqual([]);
  });

  it("a write-off needs an instrument and a quantity, and nothing comes back", () => {
    expect(checkManualTransaction(tx({ type: "WRITE_OFF", isin: DS, quantity: 7, amount: 0 }), known)).toEqual([]);
    expect(checkManualTransaction(tx({ type: "WRITE_OFF", quantity: 7, amount: 0 }), known)).toContain("WRITE_OFF needs an instrument");
    expect(checkManualTransaction(tx({ type: "WRITE_OFF", isin: DS, amount: 0 }), known)).toContain("WRITE_OFF needs a quantity");
    expect(checkManualTransaction(tx({ type: "WRITE_OFF", isin: DS, quantity: 7, amount: 50 }), known)).toEqual([
      "WRITE_OFF: nothing comes back, so the amount is 0 (money recovered later is its own transaction)",
    ]);
  });

  it("gives random ids", () => {
    const a = newTransactionId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(newTransactionId()).not.toBe(a);
  });
});

describe("instruments added from the form", () => {
  it("a retail series is valued from the Ministry file", () => {
    expect(retailInstrument({ series: "EDO1036", isin: "PL0000118899", kind: "EDO" })).toEqual({
      isin: "PL0000118899",
      code: "EDO1036",
      name: "Obligacje skarbowe EDO1036 (emerytalne 10-letnie)",
      type: "BOND_RETAIL",
      currency: "PLN",
      venue: "CALC",
      sourceIds: {},
      active: true,
      terms: "mf-retail",
    });
  });

  it("a listed treasury bond is priced from GPW with the MF terms", () => {
    expect(listedTreasuryInstrument({ isin: DS, code: "DS0432", couponType: "FIXED", couponRate: 0.0175 })).toMatchObject({ name: "Obligacje skarbowe DS0432 (stałe 1,75 %)", venue: "XWAR", sourceIds: { gpw: "DS0432" }, terms: "mf" });
    expect(listedTreasuryInstrument({ isin: "PL0000117024", code: "IZ0836", couponType: "INDEXED", couponRate: 0.02 }).name).toBe("Obligacje skarbowe IZ0836 (indeksowane inflacją, 2 %)");
    expect(listedTreasuryInstrument({ isin: "PL0000116000", code: "WZ0330", couponType: "FLOATING" }).name).toBe("Obligacje skarbowe WZ0330 (zmienne)");
  });

  it("a corporate bond is priced from BiznesRadar; an ETF from Yahoo by its exchange; a manual asset gets a ZZ id", () => {
    expect(corporateInstrument({ isin: "PLKRK0000713", code: "KRU0827", name: "Kruk", nominal: 100 })).toMatchObject({ type: "BOND_CORPORATE", venue: "CATALYST", sourceIds: { biznesradar: "KRU0827" }, nominal: 100 });
    expect(etfInstrument({ isin: "IE00B3RBWM25", ticker: "ams:vwrl", name: "Vanguard FTSE All-World", currency: "EUR" })).toMatchObject({ code: "VWRL", venue: "XAMS", sourceIds: { yahoo: "VWRL.AS" }, currency: "EUR" });
    expect(etfInstrument({ isin: "IE00B3RBWM25", ticker: "XYZ:VWRL", name: "x", currency: "EUR" })).toBeUndefined();
    expect(manualInstrument({ code: "Działka Łódź", name: "Plot" })).toMatchObject({ isin: "ZZDZIALKALO0", type: "FUND_MANUAL", venue: "MANUAL" });
  });
});
