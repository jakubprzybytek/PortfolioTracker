// Dry-run restore: parses a backup with the import code and compares the rows it would write with the table's.
//   aws s3 cp --recursive s3://<files bucket>/exports/<date>/ <folder>
//   aws dynamodb scan --table-name <transactions table> --output json > <scan.json>
//   node scripts/check-backup.ts <folder> <scan.json>
// Writes nothing: run it after a backup to know a restore would give the same rows.
import { readFileSync } from "node:fs";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { parseAccountsFile, parseNotesFile, parseTransactionFile, type TransactionItem } from "@portfolio/core";

const [dir, scanFile] = process.argv.slice(2) as [string, string];
const read = (k: string) => readFileSync(`${dir}/${k}.json`, "utf8");
const stored = (JSON.parse(readFileSync(scanFile, "utf8")) as { Items: Record<string, never>[] }).Items.map((i) => unmarshall(i) as Record<string, unknown>);
const canon = (o: unknown): string => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
const strip = ({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, updatedAt: _u, ...rest }: Record<string, unknown>) => rest;

// Transactions: what the import would write, against what's stored.
const fromBackup = parseTransactionFile(read("transactions"), "restore").map((t) => canon(t));
const inTable = stored.filter((i) => String(i["SK"]).startsWith("TX#")).map((i) => canon(strip(i) as Omit<TransactionItem, "PK">));
const missing = fromBackup.filter((t) => !inTable.includes(t));
const extra = inTable.filter((t) => !fromBackup.includes(t));
console.log(`transactions: backup ${fromBackup.length}, table ${inTable.length}, differing ${missing.length} / ${extra.length}`);
for (const m of missing.slice(0, 3)) console.log("  backup only:", m);
for (const e of extra.slice(0, 3)) console.log("  table only: ", e);

const accounts = parseAccountsFile(read("accounts")).map((a) => a.account).sort();
const accountRows = stored.filter((i) => String(i["PK"]).startsWith("ACCT#") && i["SK"] === "META").map((i) => String(i["account"])).sort();
console.log(`accounts: backup ${accounts.length}, table ${accountRows.length}, same: ${canon(accounts) === canon(accountRows)}`);
const notes = parseNotesFile(read("notes")).map((n) => n.id).sort();
const noteRows = stored.filter((i) => String(i["PK"]).startsWith("NOTE#")).map((i) => String(i["id"])).sort();
console.log(`notes: backup ${notes.length}, table ${noteRows.length}, same: ${canon(notes) === canon(noteRows)}`);
const notInBackup = [...new Set(stored.map((i) => String(i["PK"]).split("#")[0]))].filter((k) => !["ACCT", "NOTE"].includes(k!));
console.log("in the table, not in the backup:", notInBackup.join(", "));
