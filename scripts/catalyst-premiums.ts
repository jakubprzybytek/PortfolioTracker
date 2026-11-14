// Queues the premium history's (re)build (Docs/catalyst-premium-history-plan.md, step C): the State's curves of every
// session, each bond's premium on the sessions it traded, then the market index. The worker writes what it computes
// over what's there, so running it again is safe (a rule change is a rerun). Run inside the stage's shell:
//
//   npx sst shell --stage dev -- node scripts/catalyst-premiums.ts [--after <ISIN>] [--dry-run]

import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import type { CatalystMessage } from "@portfolio/core/catalyst/index";

const args = process.argv.slice(2);
const i = args.indexOf("--after");
const after = i >= 0 ? args[i + 1] : undefined;
if (i >= 0 && !after) throw new Error("usage: node scripts/catalyst-premiums.ts [--after <ISIN>] [--dry-run]");
const message: CatalystMessage = { kind: "premiums", ...(after ? { after } : {}) };
console.log(after ? `the bonds after ${after}, then the index` : "the curves, every bond, then the index");
if (args.includes("--dry-run")) console.log(JSON.stringify(message));
else {
  await new SQSClient({}).send(new SendMessageCommand({ QueueUrl: Resource.CatalystQueue.url, MessageBody: JSON.stringify(message), MessageGroupId: "catalyst", MessageDeduplicationId: randomUUID() }));
  console.log(`queued on ${Resource.CatalystQueue.url}`);
}
