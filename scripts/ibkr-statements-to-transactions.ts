// Converts IBKR activity statements (CSV: Reports → Statements → Activity, one per year at most) into a transactions
// file for the IBKR account, in its currencies (rules: packages/core/src/transactions/ibkrStatement.ts).
//
//   node scripts/ibkr-statements-to-transactions.ts <statement.csv>... [--account IBKR] [--out data/private/ibkr-from-statements.json]
//
// Pass every statement since the account was opened: the file replaces the account's history (delete its imported
// transactions first, keep those entered in the app). Prints the cash per currency at the end, to check against the
// last statement's "Cash Report".

import { readFileSync, writeFileSync } from "node:fs";
import { cashEffects, statementTransactions, type TransactionItem } from "@portfolio/core";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const account = opt("--account") ?? "IBKR";
const out = opt("--out") ?? "data/private/ibkr-from-statements.json";
if (!args.length) throw new Error("usage: node scripts/ibkr-statements-to-transactions.ts <statement.csv>... [--account IBKR] [--out file]");

const txs = statementTransactions(args.map((f) => readFileSync(f, "utf8")), account);
writeFileSync(out, JSON.stringify(txs, null, 1) + "\n");
const cash = new Map<string, number>();
for (const t of txs) for (const [c, v] of cashEffects(t as unknown as TransactionItem)) cash.set(c, (cash.get(c) ?? 0) + v);
console.log(`${txs.length} transactions → ${out}`);
console.log("cash at the end:", Object.fromEntries([...cash].map(([c, v]) => [c, Math.round(v * 1e6) / 1e6])));
