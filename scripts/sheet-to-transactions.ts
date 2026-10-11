// Converts the reference spreadsheet's "Transakcje" tab into import files.
//
//   node scripts/sheet-to-transactions.ts <export.xlsx> [--mf-retail <Dane_dotyczace_obligacji_detalicznych.xls>]
//
// Writes data/private/transactions.json and, with the Ministry retail-bond file, data/private/instruments.json
// (your retail bond series). Converts what the app can value (cash movements, instruments in
// data/instruments.json, retail bonds) and prints what it skipped and why. data/private/ is gitignored.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { convertSheetRows, parseInstrumentFile, parseRetailRates, parseTransactionFile, readSheetTransactions } from "@portfolio/core";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const mfRetail = flag("--mf-retail");
const [input] = args;
if (!input) {
  console.error("Usage: node scripts/sheet-to-transactions.ts <export.xlsx> [--mf-retail <retail-bonds.xls>]");
  process.exit(1);
}
const OUT = "data/private";

const instruments = JSON.parse(readFileSync("data/instruments.json", "utf8")) as { code: string; isin: string }[];
const byCode = new Map(instruments.map((i) => [i.code, { isin: i.isin }]));
const retail = mfRetail ? parseRetailRates(readFileSync(mfRetail)) : new Map();
if (!mfRetail) console.warn("No --mf-retail file: retail bonds are skipped.");

const rows = readSheetTransactions(readFileSync(input));
const { transactions, skipped, retailInstruments } = convertSheetRows(rows, byCode, retail);

// Same validation as the Import Lambda: fail here rather than after the upload.
parseTransactionFile(JSON.stringify(transactions), "check");
parseInstrumentFile(JSON.stringify(retailInstruments));

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/transactions.json`, JSON.stringify(transactions, null, 2) + "\n");
if (mfRetail) writeFileSync(`${OUT}/instruments.json`, JSON.stringify(retailInstruments, null, 2) + "\n");

const count = <T>(items: T[], key: (t: T) => string) =>
  [...items.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

console.log(`${rows.length} rows read, ${transactions.length} converted → ${OUT}/transactions.json`);
for (const [type, n] of count(transactions, (t) => t.type)) console.log(`  ${type.padEnd(10)} ${n}`);
if (mfRetail) console.log(`${retailInstruments.length} retail series → ${OUT}/instruments.json`);
console.log(`${skipped.length} skipped:`);
for (const [reason, n] of count(skipped, (s) => s.reason)) console.log(`  ${String(n).padStart(4)}  ${reason}`);
