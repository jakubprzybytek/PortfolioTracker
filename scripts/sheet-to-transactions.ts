// Converts the reference spreadsheet's "Transakcje" tab into a transaction import file.
//
//   node scripts/sheet-to-transactions.ts <export.xlsx> [out.json]
//
// Imports only what the app can value (cash movements + instruments in data/instruments.json) and prints
// what it skipped and why. The output holds your real transactions: it defaults to data/private/ (gitignored).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { convertSheetRows, parseTransactionFile, readSheetTransactions } from "@portfolio/core";

const [input, output = "data/private/transactions.json"] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node scripts/sheet-to-transactions.ts <export.xlsx> [out.json]");
  process.exit(1);
}

const instruments = JSON.parse(readFileSync("data/instruments.json", "utf8")) as { code: string; isin: string }[];
const byCode = new Map(instruments.map((i) => [i.code, { isin: i.isin }]));

const rows = readSheetTransactions(readFileSync(input));
const { transactions, skipped } = convertSheetRows(rows, byCode);

// Same validation as the Import Lambda: fail here rather than after the upload.
parseTransactionFile(JSON.stringify(transactions), "check");

mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(transactions, null, 2) + "\n");

const count = <T>(items: T[], key: (t: T) => string) =>
  [...items.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

console.log(`${rows.length} rows read, ${transactions.length} converted → ${output}`);
for (const [type, n] of count(transactions, (t) => t.type)) console.log(`  ${type.padEnd(10)} ${n}`);
console.log(`${skipped.length} skipped:`);
for (const [reason, n] of count(skipped, (s) => s.reason)) console.log(`  ${String(n).padStart(4)}  ${reason}`);
