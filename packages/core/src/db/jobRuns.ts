// Job runs (JOB#<job> / RUN#<startedAt>, Docs/data-storage.md): one store per table, so a module with its own table
// (Catalyst, Docs/catalyst.md) keeps its jobs' runs there while the Status page and the watchdog read them all.

import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { keys, type JobRunItem } from "./items.ts";

/** What the store needs of a DynamoDB document client (the real one, or a fake in tests). */
export interface DocumentSender {
  send(command: PutCommand | QueryCommand): Promise<{ Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }>;
}

/** Runs are kept 90 days (DynamoDB TTL). */
export const JOB_RUN_TTL_DAYS = 90;

export class JobRunStore {
  private readonly doc: DocumentSender;
  private readonly table: () => string;

  /** `table`: the table's name, read on every call (a getter, so an unlinked table fails only when used). */
  constructor(doc: DocumentSender, table: () => string) {
    this.doc = doc;
    this.table = table;
  }

  async put(item: Omit<JobRunItem, "PK" | "SK" | "ttl">, now = Date.now()): Promise<void> {
    const ttl = Math.floor(now / 1000) + JOB_RUN_TTL_DAYS * 86_400;
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...keys.jobRun(item.job, item.startedAt), ...item, ttl } }));
  }

  /** The job's runs started at or after `since` (ISO), newest first. */
  async recent(job: string, since: string): Promise<JobRunItem[]> {
    const out: JobRunItem[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.table(),
          KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
          ExpressionAttributeValues: { ":pk": `JOB#${job}`, ":from": `RUN#${since}`, ":to": "RUN#~" },
          ScanIndexForward: false,
          ExclusiveStartKey,
        }),
      );
      out.push(...((res.Items ?? []) as unknown as JobRunItem[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** The job's most recent run (one item read, not its 90 days of runs). */
  async latest(job: string): Promise<JobRunItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.table(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :run)",
        ExpressionAttributeValues: { ":pk": `JOB#${job}`, ":run": "RUN#" },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return res.Items?.[0] as JobRunItem | undefined;
  }
}
