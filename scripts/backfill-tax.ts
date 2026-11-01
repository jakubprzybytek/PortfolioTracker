// One-off: moves the tax withheld from money-in transactions' notes ("Pobrany podatek: 61.56 PLN") into their `tax`
// field, and takes that line out of the note. `amount` (already net) doesn't change, so nothing needs revaluing.
//   node scripts/backfill-tax.ts <transactions table>            # dry run: lists what it would change
//   node scripts/backfill-tax.ts <transactions table> --write    # changes it (each in the audit log, by "backfill-tax")
// Each write only lands if the row is still as read (same amount and note, no tax yet).
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { type TransactionItem, taxFromNoteLine } from "@portfolio/core";

const [table, flag] = process.argv.slice(2);
if (!table) throw new Error("Usage: node scripts/backfill-tax.ts <transactions table> [--write]");
const write = flag === "--write";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const items: TransactionItem[] = [];
let start: Record<string, unknown> | undefined;
do {
  const res = await doc.send(new ScanCommand({ TableName: table, ExclusiveStartKey: start }));
  items.push(...((res.Items ?? []) as TransactionItem[]).filter((i) => String(i.SK).startsWith("TX#")));
  start = res.LastEvaluatedKey;
} while (start);

const changes = items.flatMap((t) => {
  const b = taxFromNoteLine(t);
  return b ? [{ t, ...b }] : [];
});
// Notes that speak of tax but weren't moved: for a look by hand.
const skipped = items.filter((t) => /podat|tax/i.test(t.note ?? "") && t.type !== "TAX" && t.tax === undefined && !changes.some((c) => c.t === t));

const pad = (s: string, n: number) => s.padEnd(n);
for (const { t, tax, note } of changes.sort((a, b) => a.t.date.localeCompare(b.t.date)))
  console.log(`${t.date}  ${pad(t.account, 26)} ${pad(t.type, 9)} net ${t.amount.toFixed(2).padStart(9)} + tax ${tax.toFixed(2).padStart(7)} ${t.currency}  note: ${JSON.stringify(t.note)} → ${JSON.stringify(note ?? null)}`);
console.log(`\n${changes.length} of ${items.length} transactions get a tax.`);
for (const t of skipped) console.log(`  not moved: ${t.date} ${t.account} ${t.type} ${JSON.stringify(t.note)}`);
if (!write) {
  console.log("Dry run: nothing written (add --write).");
  process.exit(0);
}

const at = new Date().toISOString();
let done = 0;
for (const { t, tax, note } of changes) {
  await doc.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK: t.PK, SK: t.SK },
      UpdateExpression: note === undefined ? "SET tax = :tax REMOVE note" : "SET tax = :tax, note = :note",
      ConditionExpression: "attribute_not_exists(tax) AND amount = :amount AND note = :old",
      ExpressionAttributeValues: { ":tax": tax, ":amount": t.amount, ":old": t.note, ...(note === undefined ? {} : { ":note": note }) },
    }),
  );
  const { PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...before } = t;
  const { note: _n, ...rest } = before;
  const after = { ...rest, tax, ...(note === undefined ? {} : { note }) };
  await doc.send(new PutCommand({ TableName: table, Item: { PK: "TXLOG", SK: `${at}#${t.id}`, at, action: "edited", by: "backfill-tax", before, after } }));
  done++;
}
console.log(`Written: ${done}.`);
