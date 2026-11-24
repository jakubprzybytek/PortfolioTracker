// One-off (2026-11-24): retail treasury bonds' interest paid at a redemption or early redemption becomes a coupon of its
// own, the redemption or sale the principal at 100 (the Wiki's "Redemptions and interest"):
//   - a sale or redemption above 100 a bond: price 100, amount quantity × 100, and a COUPON with the rest (the tax, if
//     any, moves to the coupon);
//   - a sale at 99.50 (an early redemption's fee taken from the principal): price 100 and the fee as a fee, amount as is.
// Cash doesn't change: the coupon is the old amount less the new one, to the grosz.
//   node scripts/split-retail-interest.ts <transactions table> <market table>            # dry run
//   node scripts/split-retail-interest.ts <transactions table> <market table> --write    # writes (audit log: by "split-retail-interest")
// Each edit only lands if the row is still as read; it doesn't queue a revaluation (send one from the earliest date).
import { randomBytes } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactionItem } from "@portfolio/core";

const [table, market, flag] = process.argv.slice(2);
if (!table || !market) throw new Error("Usage: node scripts/split-retail-interest.ts <transactions table> <market table> [--write]");
const write = flag === "--write";
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const BY = "split-retail-interest";

async function scanAll<T>(params: ConstructorParameters<typeof ScanCommand>[0]): Promise<T[]> {
  const out: T[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(new ScanCommand({ ...params, ExclusiveStartKey: start }));
    out.push(...((res.Items ?? []) as T[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

const retail = new Map(
  (await scanAll<{ isin: string; code: string; type: string }>({ TableName: market, FilterExpression: "begins_with(PK, :p) AND SK = :m AND #t = :r", ExpressionAttributeNames: { "#t": "type" }, ExpressionAttributeValues: { ":p": "INST#", ":m": "META", ":r": "BOND_RETAIL" } })).map((i) => [i.isin, i.code]),
);
const txs = (await scanAll<TransactionItem>({ TableName: table })).filter((t) => String(t.SK).startsWith("TX#"));

const round2 = (v: number) => Math.round(v * 100) / 100;
const strip = ({ PK: _p, SK: _s, GSI1PK: _g, GSI1SK: _h, ...rest }: TransactionItem) => rest;

interface Change {
  before: TransactionItem;
  after: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
  coupon?: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
}
const changes: Change[] = [];
for (const t of txs) {
  if ((t.type !== "SELL" && t.type !== "REDEMPTION") || !t.isin || !retail.has(t.isin) || !t.quantity || t.currency !== "PLN") continue;
  const principal = round2(t.quantity * 100);
  const gross = round2(t.amount + (t.tax ?? 0));
  const { tax: _tax, fee: _fee, ...base } = strip(t);
  if (gross > principal + 0.005) {
    const tax = t.tax ?? 0;
    const interestNet = round2(t.amount - principal);
    const early = t.type === "SELL";
    changes.push({
      before: t,
      after: { ...base, price: 100, amount: principal, ...(t.fee ? { fee: t.fee } : {}) },
      coupon: {
        id: randomBytes(8).toString("hex"),
        date: t.date,
        account: t.account,
        type: "COUPON",
        isin: t.isin,
        amount: interestNet,
        currency: "PLN",
        ...(tax ? { tax } : {}),
        note: early ? "Interest paid with the early redemption" : "Interest paid with the redemption",
        source: BY,
      },
    });
  } else if (gross < principal - 0.005 && !t.fee && !t.tax) {
    changes.push({ before: t, after: { ...base, price: 100, fee: round2(principal - t.amount) } });
  }
}
changes.sort((a, b) => a.before.date.localeCompare(b.before.date) || a.before.account.localeCompare(b.before.account));

const code = (isin: string | undefined) => (isin ? (retail.get(isin) ?? isin) : "");
const money = (v: number | undefined) => (v === undefined ? "" : v.toFixed(2));
for (const c of changes) {
  const b = c.before;
  console.log(
    `${b.date}  ${b.account.padEnd(22)} ${b.type.padEnd(10)} ${code(b.isin).padEnd(8)} ${String(b.quantity).padStart(5)} × ${String(b.price).padStart(6)}  amount ${money(b.amount).padStart(10)} tax ${money(b.tax).padStart(7)} fee ${money(b.fee)}`,
  );
  console.log(`${"".padEnd(36)}→ ${b.type.padEnd(10)} ${String(c.after.quantity).padStart(5)} × ${String(c.after.price).padStart(6)}  amount ${money(c.after.amount).padStart(10)} fee ${money(c.after.fee)}`);
  if (c.coupon) console.log(`${"".padEnd(36)}+ COUPON                       amount ${money(c.coupon.amount).padStart(10)} tax ${money(c.coupon.tax)}  (cash ${money(c.after.amount + c.coupon.amount)} = ${money(b.amount)})`);
}
console.log(`\n${changes.length} transactions change, ${changes.filter((c) => c.coupon).length} coupons added; earliest ${changes[0]?.before.date ?? "–"}.`);
for (const c of changes) if (c.coupon && round2(c.after.amount + c.coupon.amount) !== round2(c.before.amount)) throw new Error(`cash differs for ${c.before.id}`);
if (!write) {
  console.log("Dry run: nothing written (add --write).");
  process.exit(0);
}

let done = 0;
for (const c of changes) {
  const at = new Date().toISOString();
  const b = c.before;
  const items = [
    {
      Put: {
        TableName: table,
        Item: { PK: b.PK, SK: b.SK, GSI1PK: b.GSI1PK, GSI1SK: b.GSI1SK, ...c.after },
        // Still as read: same amount, price, tax and fee.
        ConditionExpression: "amount = :amount AND price = :price AND " + (b.tax === undefined ? "attribute_not_exists(tax)" : "tax = :tax") + " AND " + (b.fee === undefined ? "attribute_not_exists(fee)" : "fee = :fee"),
        ExpressionAttributeValues: { ":amount": b.amount, ":price": b.price, ...(b.tax === undefined ? {} : { ":tax": b.tax }), ...(b.fee === undefined ? {} : { ":fee": b.fee }) },
      },
    },
    { Put: { TableName: table, Item: { PK: "TXLOG", SK: `${at}#${b.id}`, at, action: "edited", by: BY, before: strip(b), after: c.after } } },
  ];
  if (c.coupon) {
    const k = c.coupon;
    items.push(
      { Put: { TableName: table, Item: { PK: `ACCT#${k.account}`, SK: `TX#${k.date}#${k.id}`, GSI1PK: "TX", GSI1SK: `${k.date}#${k.id}`, ...k }, ConditionExpression: "attribute_not_exists(PK)" } as never },
      { Put: { TableName: table, Item: { PK: "TXLOG", SK: `${at}#${k.id}`, at, action: "added", by: BY, after: k } } },
    );
  }
  await doc.send(new TransactWriteCommand({ TransactItems: items }));
  done++;
}
console.log(`Written: ${done}.`);
