// Converts the "Transactions 2008-2022" Google Sheet (the history ledger: accounts closed before the app) into import
// files. The sheet is the source of truth for that history; this rebuilds what stage `test` holds.
//
//   node scripts/history-ledger-to-import.ts <export.xlsx | folder of tab dumps> [output folder]
//
// The input is the sheet downloaded as .xlsx (File → Download → Microsoft Excel), or a folder with one JSON file per tab
// (the tab's values as rows, as the Sheets API returns them; file name = tab name).
// Read: every tab headed Date | Account | Type | ISIN | … (rows with "In test" = Yes), Instruments, Prices, Accounts.
// Columns are found by their header; the sheet's own columns (Instrument, Cash after, Source, confidence, Remarks) are
// for reading only.
//
// Writes to the output folder (default data/private/history/, gitignored), in import order: instruments.json,
// prices.json, accounts.json, transactions.json.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseAccountsFile, parseInstrumentFile, parseManualPrices, parseTransactionFile } from "@portfolio/core";

type Cell = string | number | boolean | Date | null | undefined;
type Rows = Cell[][];

const [input, outDir] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node scripts/history-ledger-to-import.ts <export.xlsx | folder of tab dumps>");
  process.exit(1);
}
const OUT = outDir ?? "data/private/history";

function readTabs(path: string): Map<string, Rows> {
  const tabs = new Map<string, Rows>();
  if (statSync(path).isDirectory()) {
    for (const f of readdirSync(path).filter((f) => f.endsWith(".json"))) tabs.set(f.slice(0, -5), JSON.parse(readFileSync(join(path, f), "utf8")) as Rows);
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
function day(c: Cell): string {
  const s = c instanceof Date ? new Date(c.getTime() - c.getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : text(c);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Not a date: ${JSON.stringify(c)}`);
  return s;
}
const yes = (c: Cell) => c === true || /^(yes|true|prawda)$/i.test(text(c));

/** The tab's rows as records by header (first row), up to the first empty row. */
function records(rows: Rows): Record<string, Cell>[] {
  const head = (rows[0] ?? []).map(text);
  const out: Record<string, Cell>[] = [];
  for (const r of rows.slice(1)) {
    if (!r.some((c) => text(c) !== "")) break;
    out.push(Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
  return out;
}
const opt = <K extends string, V>(key: K, v: V | undefined | "") => (v === undefined || v === "" ? {} : ({ [key]: v } as Record<K, V>));

const tabs = readTabs(input);
const need = (name: string) => {
  const t = tabs.get(name);
  if (!t) throw new Error(`Tab missing: ${name}`);
  return records(t);
};

const instruments = need("Instruments").map((r) => ({
  isin: text(r["ISIN"]),
  code: text(r["Code"]),
  name: text(r["Name"]),
  type: text(r["Type"]),
  currency: text(r["Currency"]),
  venue: text(r["Venue"]),
  sourceIds: {},
  active: yes(r["Active"]),
  live: yes(r["Live"]),
  ...opt("nominal", num(r["Nominal"])),
}));
const prices = need("Prices").map((r) => ({ isin: text(r["ISIN"]), date: day(r["Date"]), price: num(r["Price"])!, currency: text(r["Currency"]), ...opt("note", text(r["Note"])) }));
const accounts = need("Accounts")
  .filter((r) => yes(r["In test"]))
  .map((r) => ({ account: text(r["Account"]) }));

const transactions: Record<string, unknown>[] = [];
for (const [name, rows] of tabs) {
  const head = (rows[0] ?? []).map(text);
  if (head.slice(0, 4).join("|") !== "Date|Account|Type|ISIN") continue;
  const rs = records(rows).filter((r) => yes(r["In test"]));
  for (const r of rs)
    transactions.push({
      date: day(r["Date"]),
      account: text(r["Account"]),
      type: text(r["Type"]),
      amount: num(r["Amount"])!,
      currency: text(r["Currency"]),
      ...opt("isin", text(r["ISIN"])),
      ...opt("quantity", num(r["Quantity"])),
      ...opt("price", num(r["Price"])),
      ...opt("fee", num(r["Fee"])),
      ...opt("note", text(r["Note"])),
    });
  console.log(`${name}: ${rs.length} transactions`);
}

// Validate with the app's own parsers before writing.
parseInstrumentFile(JSON.stringify(instruments));
parseManualPrices(JSON.stringify(prices), "check");
parseAccountsFile(JSON.stringify(accounts));
parseTransactionFile(JSON.stringify(transactions), "check");

mkdirSync(OUT, { recursive: true });
const write = (f: string, v: unknown) => writeFileSync(join(OUT, f), JSON.stringify(v, null, 1) + "\n");
write("instruments.json", instruments);
write("prices.json", prices);
write("accounts.json", accounts);
write("transactions.json", transactions);
console.log(`${OUT}: ${instruments.length} instruments, ${prices.length} prices, ${accounts.length} accounts, ${transactions.length} transactions`);
