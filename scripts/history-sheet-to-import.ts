// Converts the "Bonds 2010-2015" history spreadsheet (accounts closed before the app: DM BZWBK bonds and shares,
// savings accounts, Arka funds, XTB, a term deposit) into import files.
//
//   node scripts/history-sheet-to-import.ts <export.xlsx | folder of tab dumps>
//
// The input is the spreadsheet downloaded as .xlsx (File → Download → Microsoft Excel), or a folder with one JSON file
// per tab (the tab's values as rows, as the Sheets API returns them; file name = tab name with "_" for spaces).
// Tabs read: Bonds, Savings, Lokata, Arka, DM BZWBK, XTB, Bond prices. Columns are found by their header.
//
// Writes to data/private/history/ (gitignored), in import order:
//   instruments.json   the bonds (manually priced, no longer quoted) and the unitised positions → imports/instruments/
//   prices.json        manual prices: bonds (% of nominal), fund units, unitised positions (PLN per unit) → imports/prices/
//   accounts.json      every account → imports/accounts/
//   transactions.json  → imports/transactions/

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseAccountsFile, parseInstrumentFile, parseManualPrices, parseTransactionFile, privateAssetId } from "@portfolio/core";

type Cell = string | number | boolean | Date | null | undefined;
type Rows = Cell[][];

const [input] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node scripts/history-sheet-to-import.ts <export.xlsx | folder of tab dumps>");
  process.exit(1);
}
const OUT = "data/private/history";

// --- reading -------------------------------------------------------------------------------------
function readTabs(path: string): Map<string, Rows> {
  const tabs = new Map<string, Rows>();
  if (statSync(path).isDirectory()) {
    for (const f of readdirSync(path).filter((f) => f.endsWith(".json"))) tabs.set(f.slice(0, -5).replace(/_/g, " "), JSON.parse(readFileSync(join(path, f), "utf8")) as Rows);
  } else {
    const wb = XLSX.read(readFileSync(path), { cellDates: true });
    for (const name of wb.SheetNames) tabs.set(name, XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: "" }));
  }
  return tabs;
}

/** A number from a cell: numbers as they are, text in Polish format ("-1 234,56", spaces and NBSP as separators). */
function num(c: Cell): number | undefined {
  if (typeof c === "number") return c;
  if (typeof c !== "string") return undefined;
  const s = c.replace(/[\s  ]/g, "").replace(",", ".");
  return s === "" || Number.isNaN(Number(s)) ? undefined : Number(s);
}
const text = (c: Cell): string => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim());
/** YYYY-MM-DD from text or a date cell (xlsx). */
function day(c: Cell): string {
  const s = c instanceof Date ? new Date(c.getTime() - c.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : text(c);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Not a date: ${JSON.stringify(c)}`);
  return s;
}
const round = (v: number, d: number) => Number(v.toFixed(d));

/** The rows of a table that starts at the column headed `first` (its last occurrence with `last`), read by header name. */
function table(rows: Rows, first: string, columns: string[], last = false): Record<string, Cell>[] {
  const header = rows[0]!.map(text);
  const start = last ? header.lastIndexOf(first) : header.indexOf(first);
  if (start < 0) throw new Error(`No "${first}" column`);
  const idx = Object.fromEntries(columns.map((c) => [c, header.indexOf(c, start)]));
  for (const [c, i] of Object.entries(idx)) if (i < 0) throw new Error(`No "${c}" column after "${first}"`);
  return rows
    .slice(1)
    .filter((r) => text(r[start]) !== "")
    .map((r) => Object.fromEntries(columns.map((c) => [c, r[idx[c]!]])));
}

const tabs = readTabs(input);
const tab = (name: string): Rows => {
  const t = tabs.get(name);
  if (!t) throw new Error(`No "${name}" tab`);
  return t;
};

// --- transactions --------------------------------------------------------------------------------
type Tx = Record<string, unknown>;
const transactions: Tx[] = [];
const opt = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
const cash = (r: Record<string, Cell>, amountCol = "Amount (PLN)") =>
  opt({ date: day(r["Date"]), account: text(r["Account"]), type: text(r["Type"]), amount: round(num(r[amountCol])!, 2), currency: "PLN", note: text(r["Note"]) });

// Bonds (DM BZWBK): trades, coupons, redemptions and the account's cash movements.
for (const r of table(tab("Bonds"), "Date", ["Date", "Account", "Type", "Bond", "ISIN", "Quantity", "Price (% of nominal)", "Amount (PLN)", "Fee (PLN)", "Note"])) {
  const isin = text(r["ISIN"]);
  transactions.push(opt({ ...cash(r), isin: isin || undefined, quantity: num(r["Quantity"]), price: num(r["Price (% of nominal)"]), fee: num(r["Fee (PLN)"]) || undefined }));
}
for (const name of ["Savings", "Lokata"]) for (const r of table(tab(name), "Date", ["Date", "Account", "Type", "Amount (PLN)", "Note"])) transactions.push(cash(r));

// Unitised positions and funds: the instrument by its code (private id in the app's format).
const instrumentsOut: Record<string, unknown>[] = [];
const pricesOut: { isin: string; date: string; price: number; currency: string; note?: string }[] = [];
const manual = (code: string, name: string) => {
  const isin = privateAssetId(code);
  if (!instrumentsOut.some((i) => i["isin"] === isin)) instrumentsOut.push({ isin, code, name, type: "FUND_MANUAL", currency: "PLN", venue: "MANUAL", sourceIds: {}, active: false, live: false });
  return isin;
};
const unitTrade = (r: Record<string, Cell>, isin: string | undefined) => {
  const units = num(r["Units"]);
  const amount = num(r["Amount (PLN)"])!;
  return opt({ ...cash(r), isin, quantity: units, price: units ? round(Math.abs(amount) / units, 6) : undefined });
};

for (const r of table(tab("Arka"), "Date", ["Date", "Account", "Type", "Instrument", "Code", "Units", "Amount (PLN)", "Note"])) {
  const code = text(r["Code"]);
  transactions.push(unitTrade(r, code ? manual(code, text(r["Instrument"])) : undefined));
}
const arkaCodes = new Map(instrumentsOut.map((i) => [i["code"] as string, i["isin"] as string]));
for (const p of table(tab("Arka"), "Price date", ["Price date", "Code", "Unit price (PLN)", "Price note"])) {
  const isin = arkaCodes.get(text(p["Code"]));
  if (!isin) throw new Error(`Arka price for an unknown code ${text(p["Code"])}`);
  pricesOut.push(opt({ isin, date: day(p["Price date"]), price: num(p["Unit price (PLN)"])!, currency: "PLN", note: text(p["Price note"]) }) as (typeof pricesOut)[0]);
}

// DM BZWBK shares/certificates and XTB: one unitised position each; month-end prices = value / units.
const UNITISED: Record<string, { tab: string; code: string }> = {
  "DM BZWBK shares/certificates (unknown)": { tab: "DM BZWBK", code: "DMBZWBKSH" },
  "XTB forex": { tab: "XTB", code: "XTBFOREX" },
};
for (const [name, { tab: t, code }] of Object.entries(UNITISED)) {
  const isin = manual(code, name);
  for (const r of table(tab(t), "Date", ["Date", "Account", "Type", "Instrument", "Units", "Amount (PLN)", "Note"])) transactions.push(unitTrade(r, text(r["Instrument"]) ? isin : undefined));
  for (const p of table(tab(t), "Month end", ["Month end", "Value (PLN)", "Units held"]))
    pricesOut.push({ isin, date: day(p["Month end"]), price: round(num(p["Value (PLN)"])! / num(p["Units held"])!, 6), currency: "PLN", note: "month end: the sheet's value / units" });
}

// Bonds: no longer quoted, priced by hand (% of nominal); a write-off (0 %) needs no price, the redemption at 0 closes it.
for (const b of table(tab("Bond prices"), "Bond", ["Bond", "ISIN", "Issuer", "Kind", "Nominal (PLN)", "Coupon"], true)) {
  const code = text(b["Bond"]);
  const treasury = text(b["Kind"]).startsWith("treasury");
  instrumentsOut.push({
    isin: text(b["ISIN"]),
    code,
    name: treasury ? `Obligacje skarbowe ${code} (${text(b["Coupon"])})` : `${text(b["Issuer"])} ${code} (${text(b["Coupon"])})`,
    type: "BOND_CORPORATE",
    currency: "PLN",
    venue: "MANUAL",
    sourceIds: {},
    active: false,
    live: false,
    nominal: num(b["Nominal (PLN)"]),
  });
}
for (const p of table(tab("Bond prices"), "Price date", ["Price date", "ISIN", "Clean price (% of nominal)", "Note"])) {
  const price = num(p["Clean price (% of nominal)"])!;
  if (price > 0) pricesOut.push(opt({ isin: text(p["ISIN"]), date: day(p["Price date"]), price, currency: "PLN", note: text(p["Note"]) }) as (typeof pricesOut)[0]);
}

// --- checks and output ---------------------------------------------------------------------------
const known = new Set(instrumentsOut.map((i) => i["isin"] as string));
for (const t of transactions) if (t["isin"] && !known.has(t["isin"] as string)) throw new Error(`Transaction for an unknown instrument: ${JSON.stringify(t)}`);
for (const p of pricesOut) if (!known.has(p.isin)) throw new Error(`Price for an unknown instrument: ${JSON.stringify(p)}`);
const accounts = [...new Set(transactions.map((t) => t["account"] as string))].sort().map((account) => ({ account }));

// Same validation as the Import Lambda: fail here rather than after the upload.
const parsed = parseTransactionFile(JSON.stringify(transactions), "check");
if (new Set(parsed.map((t) => t.id)).size !== parsed.length) throw new Error("Two transactions with the same id (identical rows): make them differ");
parseInstrumentFile(JSON.stringify(instrumentsOut));
parseManualPrices(JSON.stringify(pricesOut), "check");
parseAccountsFile(JSON.stringify(accounts));

// Cash per account (lowest point, end) and the units of every position at the end, in the tabs' order within a day.
const flow = (t: Tx) => (t["type"] === "BUY" ? (t["amount"] as number) - ((t["fee"] as number) ?? 0) : (t["amount"] as number));
const byDay = [...transactions].sort((a, b) => (a["date"] as string).localeCompare(b["date"] as string));
const balance = new Map<string, number>();
const units = new Map<string, number>();
let lowest = { account: "", date: "", cash: 0 };
for (const t of byDay) {
  const a = t["account"] as string;
  const b = round((balance.get(a) ?? 0) + flow(t), 2);
  balance.set(a, b);
  if (b < lowest.cash) lowest = { account: a, date: t["date"] as string, cash: b };
  if (t["isin"] && t["quantity"]) units.set(t["isin"] as string, round((units.get(t["isin"] as string) ?? 0) + (t["type"] === "BUY" ? 1 : -1) * (t["quantity"] as number), 6));
}

mkdirSync(OUT, { recursive: true });
const write = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2) + "\n");
write("instruments.json", instrumentsOut);
write("prices.json", pricesOut);
write("accounts.json", accounts);
write("transactions.json", transactions);

console.log(`${transactions.length} transactions, ${instrumentsOut.length} instruments, ${pricesOut.length} prices, ${accounts.length} accounts → ${OUT}/`);
for (const [a, b] of balance) console.log(`  ${a.padEnd(24)} cash at the end ${b.toFixed(2)}`);
const open = [...units].filter(([, u]) => Math.abs(u) > 0.0005);
console.log(open.length ? `  still held: ${open.map(([i, u]) => `${i} ${u}`).join(", ")}` : "  every position closed");
if (lowest.cash < 0) console.log(`  lowest cash: ${lowest.cash.toFixed(2)} in ${lowest.account} on ${lowest.date} (the app adds up a day's transactions together)`);
if (!existsSync(".sst/outputs.json")) console.log("Upload in order: instruments, prices, accounts, transactions (data/README.md).");
