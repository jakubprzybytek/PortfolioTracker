// Converts the reference spreadsheet's "Transakcje" tab into import files.
//
//   node scripts/sheet-to-transactions.ts <export.xlsx> [--mf-retail <Dane_dotyczace_obligacji_detalicznych.xls>]
//
// Writes to data/private/ (gitignored), in import order:
//   instruments.json   your retail bond series (with --mf-retail) and manually valued assets → imports/instruments/
//   prices.json        manual prices: purchase prices + the sheet's current value → imports/prices/
//   accounts.json      every account, with what isn't tracked yet ("incomplete") → imports/accounts/
//   transactions.json  → imports/transactions/
// Converts what the app can value (cash movements, instruments in data/instruments.json, retail bonds, manually
// valued assets) and prints what it skipped and why.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  convertSheetRows,
  parseAccountsFile,
  parseInstrumentFile,
  parseManualPrices,
  parseRetailRates,
  parseTransactionFile,
  readSheetManualPrices,
  readSheetTransactions,
  today,
} from "@portfolio/core";

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

const workbook = readFileSync(input);
const rows = readSheetTransactions(workbook);
const { transactions, skipped, retailInstruments, manualInstruments, manualPrices, accounts } = convertSheetRows(rows, byCode, retail);
const instrumentsOut = [...retailInstruments, ...manualInstruments];
const pricesOut = [...manualPrices, ...readSheetManualPrices(workbook, today())];

// Same validation as the Import Lambda: fail here rather than after the upload.
parseTransactionFile(JSON.stringify(transactions), "check");
parseInstrumentFile(JSON.stringify(instrumentsOut));
parseManualPrices(JSON.stringify(pricesOut), "check");
parseAccountsFile(JSON.stringify(accounts));

const write = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2) + "\n");
mkdirSync(OUT, { recursive: true });
write("instruments.json", instrumentsOut);
write("prices.json", pricesOut);
write("accounts.json", accounts);
write("transactions.json", transactions);

const count = <T>(items: T[], key: (t: T) => string) =>
  [...items.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

console.log(`${rows.length} rows read, ${transactions.length} converted → ${OUT}/transactions.json`);
for (const [type, n] of count(transactions, (t) => t.type)) console.log(`  ${type.padEnd(10)} ${n}`);
console.log(`${retailInstruments.length} retail series + ${manualInstruments.length} manually valued → ${OUT}/instruments.json; ${pricesOut.length} manual prices → ${OUT}/prices.json`);
console.log("accounts → accounts.json:");
for (const a of accounts) console.log(`  ${a.account.padEnd(26)} ${a.incomplete.length ? "incomplete: " + a.incomplete.join(", ") : "complete"}`);
console.log(`${skipped.length} skipped:`);
for (const [reason, n] of count(skipped, (s) => s.reason)) console.log(`  ${String(n).padStart(4)}  ${reason}`);
