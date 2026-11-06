// Queues the Catalyst backfill (Docs/catalyst-phase1-plan.md, M3): the daily-file archive from --from to --to in
// ranges of --sessions trading sessions, newest first, then a metrics request. Days already loaded are skipped by
// the worker, so running it again is safe. Run inside the stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-backfill.ts --from 2020-01-02 --to 2026-10-29 [--sessions 20] [--dry-run]

import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { sessionsBetween, type CatalystMessage } from "@portfolio/core/catalyst/index";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const from = opt("--from");
const to = opt("--to");
const size = Number(opt("--sessions") ?? 20);
const dryRun = args.includes("--dry-run");
if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !(size > 0))
  throw new Error("usage: node scripts/catalyst-backfill.ts --from YYYY-MM-DD --to YYYY-MM-DD [--sessions 20] [--dry-run]");

// Ranges of `size` sessions, newest first.
const sessions = sessionsBetween(from, to);
const messages: CatalystMessage[] = [];
for (let i = 0; i < sessions.length; i += size) {
  const chunk = sessions.slice(i, i + size);
  messages.push({ kind: "backfill", from: chunk.at(-1)!, to: chunk[0]! });
}
messages.push({ kind: "metrics" });
console.log(`${sessions.length} sessions in ${messages.length - 1} ranges, ${messages[0]?.kind === "backfill" ? `${messages[0].to} back to ${from}` : "none"}, then the metrics`);
if (dryRun) {
  for (const m of messages) console.log(JSON.stringify(m));
} else {
  const sqs = new SQSClient({});
  for (const m of messages)
    await sqs.send(new SendMessageCommand({ QueueUrl: Resource.CatalystQueue.url, MessageBody: JSON.stringify(m), MessageGroupId: "catalyst", MessageDeduplicationId: randomUUID() }));
  console.log(`queued on ${Resource.CatalystQueue.url}`);
}
