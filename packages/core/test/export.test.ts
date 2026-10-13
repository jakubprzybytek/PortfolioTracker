import { describe, expect, it } from "vitest";
import { exportFiles } from "../src/backup/export.ts";
import type { AccountItem, InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { parseInstrumentFile } from "../src/instruments/schema.ts";
import { parseManualPrices } from "../src/prices/manual.ts";
import { parseTransactionFile } from "../src/transactions/schema.ts";

const inst = (i: Partial<InstrumentItem> & Pick<InstrumentItem, "isin" | "type">): InstrumentItem =>
  ({ PK: `INST#${i.isin}`, SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: i.isin, code: i.isin, name: i.isin, currency: "PLN", venue: "XWAR", sourceIds: {}, active: true, live: false, updatedAt: "x", ...i }) as InstrumentItem;
const tx = (t: Partial<TransactionItem> & Pick<TransactionItem, "id" | "date" | "type" | "amount" | "source">): TransactionItem =>
  ({ PK: "ACCT#broker", SK: `TX#${t.date}#${t.id}`, GSI1PK: "TX", GSI1SK: `${t.date}#${t.id}`, account: "broker", currency: "PLN", ...t }) as TransactionItem;

describe("exportFiles", () => {
  const files = exportFiles({
    accounts: [{ PK: "ACCT#eur", SK: "META", GSI1PK: "ACCOUNT", GSI1SK: "eur", account: "eur", baseCurrency: "EUR", updatedAt: "x" } as AccountItem],
    instruments: [
      inst({ isin: "PL0000116798", type: "BOND_RETAIL", code: "EDO0332", retail: {} as never }),
      inst({ isin: "PL0000115865", type: "BOND_LISTED", code: "DS0432", terms: {} as never }),
      inst({ isin: "ZZRZESZOW000", type: "FUND_MANUAL", venue: "MANUAL" }),
      inst({ isin: "MF-TERMS", type: "FUND_MANUAL" }),
    ],
    manualPrices: [{ isin: "ZZRZESZOW000", venue: "MANUAL", date: "2026-10-01", close: 1050, currency: "PLN" } as PriceItem],
    transactions: [
      tx({ id: "b", date: "2026-10-02", type: "DEPOSIT", amount: 100, source: "app" }),
      tx({ id: "a", date: "2026-10-01", type: "BUY", isin: "ZZRZESZOW000", quantity: 1, price: 1000, amount: -1000, source: "imports/transactions/x.json" }),
    ],
  });

  it("writes each kind in its import format, which the importers read back", () => {
    expect(files.accounts).toEqual([{ account: "eur", baseCurrency: "EUR" }]);
    const instruments = parseInstrumentFile(JSON.stringify(files.instruments));
    expect(instruments.map((i) => [i.code, i.terms ?? null])).toEqual([
      ["DS0432", "mf"],
      ["EDO0332", "mf-retail"],
      ["ZZRZESZOW000", null],
    ]);
    expect(parseManualPrices(JSON.stringify(files.prices), "restore").map((p) => [p.SK, p.close])).toEqual([["PX#MANUAL#2026-10-01", 1050]]);
  });

  it("keeps transaction ids and sources, oldest first", () => {
    const restored = parseTransactionFile(JSON.stringify(files.transactions), "imports/transactions/restore.json");
    expect(restored.map((t) => [t.id, t.source])).toEqual([
      ["a", "imports/transactions/x.json"],
      ["b", "app"],
    ]);
  });
});
