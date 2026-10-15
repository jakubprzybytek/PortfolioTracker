import { describe, expect, it } from "vitest";
import { exportFiles } from "../src/backup/export.ts";
import { parseCouponPeriods } from "../src/bonds/couponPeriods.ts";
import type { AccountItem, InstrumentItem, PriceItem, TransactionItem } from "../src/db/items.ts";
import { parseInstrumentFile } from "../src/instruments/schema.ts";
import { NoteFields, parseNotesFile } from "../src/notes/schema.ts";
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
    couponPeriods: [
      { PK: "INST#PLKRK0000713", SK: "COUPON#2026-08-12", isin: "PLKRK0000713", start: "2026-08-12", end: "2026-11-12", recordDate: "2026-11-03", paymentDate: "2026-11-12", datesSource: "obligacje.pl", rate: 0.0713, rateSource: "manual", updatedAt: "x" },
    ],
    transactions: [
      tx({ id: "b", date: "2026-10-02", type: "DEPOSIT", amount: 100, source: "app" }),
      tx({ id: "a", date: "2026-10-01", type: "BUY", isin: "ZZRZESZOW000", quantity: 1, price: 1000, amount: -1000, source: "imports/transactions/x.json" }),
    ],
    notes: [
      { PK: "NOTE#n2", SK: "META", GSI1PK: "NOTE", GSI1SK: "n2", id: "n2", title: "Later", body: "", createdAt: "2026-10-15T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z" },
      { PK: "NOTE#n1", SK: "META", GSI1PK: "NOTE", GSI1SK: "n1", id: "n1", title: "IBKR", body: "# Best practices\n\n- one", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-16T10:00:00.000Z" },
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
    expect(parseCouponPeriods(JSON.stringify(files.coupons))).toEqual([
      { isin: "PLKRK0000713", start: "2026-08-12", end: "2026-11-12", recordDate: "2026-11-03", paymentDate: "2026-11-12", datesSource: "obligacje.pl", rate: 0.0713, rateSource: "manual" },
    ]);
  });

  it("keeps transaction ids and sources, oldest first", () => {
    const restored = parseTransactionFile(JSON.stringify(files.transactions), "imports/transactions/restore.json");
    expect(restored.map((t) => [t.id, t.source])).toEqual([
      ["a", "imports/transactions/x.json"],
      ["b", "app"],
    ]);
  });

  it("keeps notes whole, oldest first, readable by the notes import", () => {
    expect(parseNotesFile(JSON.stringify(files.notes))).toEqual([
      { id: "n1", title: "IBKR", body: "# Best practices\n\n- one", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-16T10:00:00.000Z" },
      { id: "n2", title: "Later", body: "", createdAt: "2026-10-15T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z" },
    ]);
  });
});

describe("notes", () => {
  it("need a title; the text may be empty", () => {
    expect(NoteFields.safeParse({ title: "  a ", body: "" }).data).toEqual({ title: "a", body: "" });
    expect(NoteFields.safeParse({ title: "   ", body: "x" }).success).toBe(false);
    expect(NoteFields.safeParse({ title: "a" }).success).toBe(false);
  });

  it("reject a backup record with a bad id or date", () => {
    expect(() => parseNotesFile(JSON.stringify([{ id: "../x", title: "a", body: "", createdAt: "2026-10-14T10:00:00.000Z", updatedAt: "2026-10-14T10:00:00.000Z" }]))).toThrow();
    expect(() => parseNotesFile(JSON.stringify([{ id: "a1", title: "a", body: "", createdAt: "yesterday", updatedAt: "2026-10-14T10:00:00.000Z" }]))).toThrow();
  });
});
