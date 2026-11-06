// Wiring of the Catalyst module's functions: its table and its queue (infra/catalyst.ts).

import { randomUUID } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { CatalystRepository, type CatalystMessage } from "@portfolio/core/catalyst/index";

export const catalystRepo = new CatalystRepository(() => Resource.Catalyst.name);

const sqs = new SQSClient({});

/** Puts a request on the Catalyst queue: one message group, so requests run one at a time, in order. */
export async function queueCatalyst(message: CatalystMessage): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: Resource.CatalystQueue.url, MessageBody: JSON.stringify(message), MessageGroupId: "catalyst", MessageDeduplicationId: randomUUID() }));
}
