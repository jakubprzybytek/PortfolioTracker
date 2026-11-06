// Access to the Catalyst module's table (Docs/catalyst.md, "Storage"). Separate from PT's Repository: the module's
// functions link only this table.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { IsoDate } from "../dates.ts";
import { JobRunStore } from "../db/jobRuns.ts";
import { catalystKeys, type CatalystBondItem, type CatalystDayItem, type CatalystSessionItem } from "./items.ts";

/** Batches of 25 written at once, at most. */
const BATCH_WRITES_AT_ONCE = 4;

export class CatalystRepository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: () => string;
  /** The Catalyst jobs' runs (JOB#/RUN# items in this table). */
  readonly jobRuns: JobRunStore;

  /** `table`: the table's name, read on every call. */
  constructor(table: () => string, client: DynamoDBClient = new DynamoDBClient({})) {
    this.table = table;
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
    this.jobRuns = new JobRunStore(this.doc, table);
  }

  getBond(isin: string): Promise<CatalystBondItem | undefined> {
    return this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.bond(isin) })).then((r) => r.Item as CatalystBondItem | undefined);
  }

  /** Every bond ever seen (listed, suspended and ended). */
  listBonds(): Promise<CatalystBondItem[]> {
    return this.queryAll<CatalystBondItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "BOND" } });
  }

  /** How many bonds the table holds (counted on the index, no items read back). */
  async countBonds(): Promise<number> {
    let count = 0;
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(new QueryCommand({ TableName: this.table(), IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "BOND" }, Select: "COUNT", ExclusiveStartKey }));
      count += res.Count ?? 0;
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return count;
  }

  putBonds(items: Omit<CatalystBondItem, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "updatedAt">[]): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut(items.map((b) => ({ ...catalystKeys.bond(b.isin), GSI1PK: "BOND", GSI1SK: b.code, ...b, updatedAt })));
  }

  putSessions(items: Omit<CatalystSessionItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut(items.map((s) => ({ ...catalystKeys.session(s.isin, s.date, s.market), ...s })));
  }

  /** A bond's sessions from `from` to `to` (inclusive), every market, oldest first. */
  listSessions(isin: string, from: IsoDate, to: IsoDate): Promise<CatalystSessionItem[]> {
    return this.queryAll<CatalystSessionItem>({
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `BOND#${isin}`, ":from": `D#${from}`, ":to": `D#${to}#~` },
    });
  }

  /** The sessions loaded from `from` to `to` (inclusive), oldest first. */
  listDays(from: IsoDate, to: IsoDate): Promise<CatalystDayItem[]> {
    return this.queryAll<CatalystDayItem>({ KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to", ExpressionAttributeValues: { ":pk": "DAYS", ":from": from, ":to": to } });
  }

  /** The latest session loaded, if any. */
  async latestDay(): Promise<CatalystDayItem | undefined> {
    const res = await this.doc.send(new QueryCommand({ TableName: this.table(), KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": "DAYS" }, ScanIndexForward: false, Limit: 1 }));
    return res.Items?.[0] as CatalystDayItem | undefined;
  }

  async putDay(item: Omit<CatalystDayItem, "PK" | "SK">): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.day(item.date), ...item } }));
  }

  private async queryAll<T>(input: Omit<QueryCommandInput, "TableName">): Promise<T[]> {
    const out: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(new QueryCommand({ TableName: this.table(), ...input, ExclusiveStartKey }));
      out.push(...((res.Items ?? []) as T[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** Writes in batches of 25, a few at once, retrying unprocessed items. Returns the number of items written. */
  private async batchPut(items: object[]): Promise<number> {
    const tableName = this.table();
    const batches: { PutRequest: { Item: object } }[][] = [];
    for (let i = 0; i < items.length; i += 25) batches.push(items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })));
    const send = async (batch: { PutRequest: { Item: object } }[]) => {
      let requests = batch;
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt > 8) throw new Error(`BatchWrite: ${requests.length} items still unprocessed after ${attempt} attempts`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res = await this.doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
        requests = (res.UnprocessedItems?.[tableName] ?? []) as typeof requests;
      }
    };
    let next = 0;
    const worker = async () => {
      while (next < batches.length) await send(batches[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(BATCH_WRITES_AT_ONCE, batches.length) }, worker));
    return items.length;
  }
}
