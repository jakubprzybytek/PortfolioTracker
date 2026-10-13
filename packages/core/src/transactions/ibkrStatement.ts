// IBKR activity statements (Reports → Statements → Activity, CSV) → transactions, in the account's currencies.
//
// The statement is a stack of sections, each with its own header row: `<Section>,Header,<columns…>` then
// `<Section>,Data,<values…>`. Used: Deposits & Withdrawals, Trades, Interest, Withholding Tax, Corporate Actions
// (maturities) and Financial Instrument Information (symbol → ISIN). Several statements may be passed (IBKR limits
// one to a year); a row in two overlapping statements counts once (as often as the statement having it most often, so
// two equal deposits on one day stay two).
//
// Booked as:
// - deposits and withdrawals on the day IBKR credited them (settle date), in the currency sent;
// - forex trades netted per day and currency pair into one EXCHANGE (IBKR's automatic conversions go back and forth
//   within a minute); their commissions, charged in the base currency, as one FEE per day;
// - bond and bill trades as BUY/SELL, quantity in bonds of 1000 nominal, price in % (clean), commission as the fee;
// - accrued interest paid with a purchase added to that purchase's amount (part of its cost);
// - coupons as COUPON, broker interest as INTEREST, withholding tax as TAX;
// - maturities as REDEMPTION at 100 on the report date.

import type { TransactionType } from "../db/items.ts";

export interface StatementTransaction {
  date: string;
  account: string;
  type: TransactionType;
  isin?: string;
  quantity?: number;
  price?: number;
  amount: number;
  fee?: number;
  currency: string;
  toAmount?: number;
  toCurrency?: string;
  note?: string;
}

/** One CSV line → fields (quoted fields may hold commas and "" for a quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

type Row = Record<string, string>;

/** Data rows per section, keyed by that section's latest header; statements merged (see above). */
function sections(csvs: string[]): Map<string, Row[]> {
  const merged = new Map<string, { section: string; row: Row; count: number }>();
  for (const csv of csvs) {
    const headers = new Map<string, string[]>();
    const counts = new Map<string, { section: string; row: Row; count: number }>();
    for (const line of csv.replace(/^﻿/, "").split(/\r?\n/)) {
      const [section, kind, ...rest] = splitCsvLine(line);
      if (!section || !kind) continue;
      if (kind === "Header") headers.set(section, rest);
      else if (kind === "Data" && headers.has(section)) {
        const cols = headers.get(section)!;
        const row: Row = {};
        cols.forEach((c, i) => {
          if (c && !(c in row)) row[c] = rest[i] ?? "";
        });
        const key = JSON.stringify([section, row]);
        const e = counts.get(key) ?? { section, row, count: 0 };
        e.count++;
        counts.set(key, e);
      }
    }
    for (const [key, e] of counts) if (e.count > (merged.get(key)?.count ?? 0)) merged.set(key, e);
  }
  const data = new Map<string, Row[]>();
  for (const { section, row, count } of merged.values()) data.set(section, [...(data.get(section) ?? []), ...Array<Row>(count).fill(row)]);
  return data;
}

const num = (s: string | undefined): number => Number((s ?? "").replace(/,/g, ""));
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

export function statementTransactions(csvs: string[], account = "IBKR"): StatementTransaction[] {
  const data = sections(csvs);
  const rows = (s: string) => data.get(s) ?? [];
  const isinOf = new Map<string, string>();
  for (const r of rows("Financial Instrument Information")) for (const s of (r["Symbol"] ?? "").split(", ")) isinOf.set(s, r["Security ID"]!);
  const isin = (symbol: string) => {
    const v = isinOf.get(symbol);
    if (!v) throw new Error(`No ISIN for "${symbol}" in Financial Instrument Information`);
    return v;
  };

  const out: StatementTransaction[] = [];
  const add = (t: StatementTransaction) => void out.push(t);

  for (const r of rows("Deposits & Withdrawals")) {
    if (!r["Settle Date"]) continue; // totals
    const amount = num(r["Amount"]);
    add({ date: r["Settle Date"], account, type: amount > 0 ? "DEPOSIT" : "WITHDRAWAL", amount, currency: r["Currency"]! });
  }

  const fx = new Map<string, { date: string; base: string; quote: string; quantity: number; proceeds: number }>();
  const fxFee = new Map<string, number>();
  for (const r of rows("Trades")) {
    if (r["DataDiscriminator"] !== "Order") continue;
    const date = r["Date/Time"]!.slice(0, 10);
    const quantity = num(r["Quantity"]);
    if (r["Asset Category"] === "Forex") {
      const [base, quote] = r["Symbol"]!.split(".") as [string, string];
      const k = `${date}|${base}|${quote}`;
      const f = fx.get(k) ?? { date, base, quote, quantity: 0, proceeds: 0 };
      f.quantity += quantity;
      f.proceeds += num(r["Proceeds"]);
      fx.set(k, f);
      fxFee.set(date, (fxFee.get(date) ?? 0) - num(r["Comm in EUR"]));
      continue;
    }
    // "912797SA6 3.68147411%" (bills) / "DBR 0 11/15/27 1.92104963%" (bonds): the symbol, then the yield.
    const words = r["Symbol"]!.split(" ");
    const symbol = r["Asset Category"] === "Treasury Bills" ? words[0]! : words.slice(0, -1).join(" ");
    const fee = -num(r["Comm/Fee"]);
    add({
      date,
      account,
      type: quantity > 0 ? "BUY" : "SELL",
      isin: isin(symbol),
      quantity: Math.abs(quantity) / 1000,
      price: num(r["T. Price"]),
      amount: quantity > 0 ? num(r["Proceeds"]) : r2(num(r["Proceeds"]) - fee), // a sale: received net of the fee
      fee,
      currency: r["Currency"]!,
    });
  }
  for (const f of [...fx.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (Math.abs(f.quantity) < 1e-9 && Math.abs(f.proceeds) < 1e-9) continue;
    if (f.quantity > 0 === f.proceeds > 0) throw new Error(`Forex ${f.base}.${f.quote} on ${f.date}: bought and paid in the same direction`);
    add(
      f.quantity > 0
        ? { date: f.date, account, type: "EXCHANGE", amount: r6(f.proceeds), currency: f.quote, toAmount: r6(f.quantity), toCurrency: f.base }
        : { date: f.date, account, type: "EXCHANGE", amount: r6(f.quantity), currency: f.base, toAmount: r6(f.proceeds), toCurrency: f.quote },
    );
  }
  for (const [date, fee] of [...fxFee].sort()) if (fee > 1e-9) add({ date, account, type: "FEE", amount: -r6(fee), currency: "EUR", note: "FX commission" });

  for (const r of rows("Interest")) {
    if (!r["Date"] || r["Currency"] === "Total") continue;
    const amount = num(r["Amount"]);
    const desc = r["Description"]!;
    const currency = r["Currency"]!;
    if (desc.startsWith("Purchase Accrued Interest ")) {
      const id = isin(desc.slice("Purchase Accrued Interest ".length));
      const buy = out.find((t) => t.type === "BUY" && t.isin === id && t.date === r["Date"]);
      if (!buy) throw new Error(`${desc} on ${r["Date"]}: no purchase that day`);
      buy.amount = r2(buy.amount + amount);
      buy.note = `incl. ${(-amount).toFixed(2)} ${currency} accrued interest`;
    } else if (desc.startsWith("Bond Coupon Payment")) {
      add({ date: r["Date"], account, type: "COUPON", isin: isin(desc.slice(desc.indexOf("(") + 1, desc.indexOf(" - "))), amount, currency });
    } else add({ date: r["Date"], account, type: "INTEREST", amount, currency, note: desc });
  }
  for (const r of rows("Withholding Tax")) {
    if (!r["Date"] || r["Currency"] === "Total") continue;
    add({ date: r["Date"], account, type: "TAX", amount: num(r["Amount"]), currency: r["Currency"]!, note: r["Description"] });
  }
  for (const r of rows("Corporate Actions")) {
    if (!r["Report Date"]) continue; // totals
    const m = /^\((\w{12})\)/.exec(r["Description"] ?? "");
    if (!m || !/Maturity/.test(r["Description"]!)) throw new Error(`Corporate action not handled: ${r["Description"]}`);
    add({ date: r["Report Date"], account, type: "REDEMPTION", isin: m[1]!, quantity: -num(r["Quantity"]) / 1000, price: 100, amount: num(r["Proceeds"]), currency: r["Currency"]! });
  }

  const order = (t: StatementTransaction) => `${t.date}|${t.type}`;
  return out.sort((a, b) => order(a).localeCompare(order(b)));
}
