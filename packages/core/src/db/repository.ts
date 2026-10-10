import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { IsoDate } from "../dates.ts";
import type { ReferenceIndexMonth } from "../bonds/izIndex.ts";
import {
  keys,
  type BackfillItem,
  type CouponRateItem,
  type InstrumentItem,
  type JobRunItem,
  type PriceItem,
  type ReferenceIndexItem,
  type SnapshotItem,
  type TransactionItem,
} from "./items.ts";

const GSI1 = "GSI1";

/** Typed access to the single table. Table name is injected so core stays free of SST imports. */
export class Repository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(tableName: string, client: DynamoDBClient = new DynamoDBClient({})) {
    this.tableName = tableName;
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  // --- generic helpers -------------------------------------------------------------------------

  private async get<T>(key: { PK: string; SK: string }): Promise<T | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: key }));
    return res.Item as T | undefined;
  }

  private async put(item: object): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  /** Writes in batches of 25, retrying unprocessed items. Returns the number of items written. */
  async batchPut(items: object[]): Promise<number> {
    for (let i = 0; i < items.length; i += 25) {
      let requests = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt > 8) throw new Error(`BatchWrite: ${requests.length} items still unprocessed after ${attempt} attempts`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res = await this.doc.send(new BatchWriteCommand({ RequestItems: { [this.tableName]: requests } }));
        requests = (res.UnprocessedItems?.[this.tableName] ?? []) as typeof requests;
      }
    }
    return items.length;
  }

  private async queryAll<T>(input: Omit<QueryCommandInput, "TableName">): Promise<T[]> {
    const out: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(new QueryCommand({ TableName: this.tableName, ...input, ExclusiveStartKey }));
      out.push(...((res.Items ?? []) as T[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  // --- instruments -----------------------------------------------------------------------------

  async putInstrument(item: Omit<InstrumentItem, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "updatedAt">): Promise<InstrumentItem> {
    const full: InstrumentItem = { ...keys.instrument(item.isin), GSI1PK: "INSTRUMENT", GSI1SK: item.isin, ...item, updatedAt: new Date().toISOString() };
    await this.put(full);
    return full;
  }

  getInstrument(isin: string): Promise<InstrumentItem | undefined> {
    return this.get<InstrumentItem>(keys.instrument(isin));
  }

  listInstruments(): Promise<InstrumentItem[]> {
    return this.queryAll<InstrumentItem>({
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "INSTRUMENT" },
    });
  }

  // --- prices ----------------------------------------------------------------------------------

  putPrices(items: PriceItem[]): Promise<number> {
    return this.batchPut(items);
  }

  queryPrices(isin: string, venue: string, from: IsoDate, to: IsoDate): Promise<PriceItem[]> {
    const { PK, SK } = keys.pricePrefix(isin, venue);
    return this.queryAll<PriceItem>({
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": PK, ":from": `${SK}${from}`, ":to": `${SK}${to}` },
    });
  }

  /** The latest price on or before `date`. */
  async latestPrice(isin: string, venue: string, date: IsoDate): Promise<PriceItem | undefined> {
    const { PK, SK } = keys.pricePrefix(isin, venue);
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
        ExpressionAttributeValues: { ":pk": PK, ":from": `${SK}0000-00-00`, ":to": `${SK}${date}` },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return res.Items?.[0] as PriceItem | undefined;
  }

  /** Dates that already have a price in [from, to]. */
  async priceDates(isin: string, venue: string, from: IsoDate, to: IsoDate): Promise<Set<IsoDate>> {
    const { PK, SK } = keys.pricePrefix(isin, venue);
    const items = await this.queryAll<{ SK: string }>({
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": PK, ":from": `${SK}${from}`, ":to": `${SK}${to}` },
      ProjectionExpression: "SK",
    });
    return new Set(items.map((i) => i.SK.slice(SK.length)));
  }

  // --- reference index (IZ indexation) ---------------------------------------------------------

  putReferenceIndex(months: ReferenceIndexMonth[], source: string): Promise<number> {
    const updatedAt = new Date().toISOString();
    const items: ReferenceIndexItem[] = months.map((m) => ({ ...keys.referenceIndex(m.month), ...m, source, updatedAt }));
    return this.batchPut(items);
  }

  listReferenceIndex(): Promise<ReferenceIndexItem[]> {
    return this.queryAll<ReferenceIndexItem>({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "CPI_REF" },
    });
  }

  // --- floating coupon rates -------------------------------------------------------------------

  putCouponRates(items: Omit<CouponRateItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut(items.map((i) => ({ ...keys.couponRate(i.isin, i.periodStart), ...i })));
  }

  listCouponRates(isin: string): Promise<CouponRateItem[]> {
    return this.queryAll<CouponRateItem>({
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `INST#${isin}`, ":sk": "COUPON#" },
    });
  }

  // --- transactions ----------------------------------------------------------------------------

  putTransactions(items: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(
      items.map((t) => ({ ...keys.transaction(t.account, t.date, t.id), GSI1PK: "TX", GSI1SK: `${t.date}#${t.id}`, ...t })),
    );
  }

  /** All transactions, oldest first. */
  listTransactions(): Promise<TransactionItem[]> {
    return this.queryAll<TransactionItem>({
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "TX" },
    });
  }

  // --- snapshots -------------------------------------------------------------------------------

  async putSnapshot(snapshot: Omit<SnapshotItem, "PK" | "SK">, alsoLatest: boolean): Promise<void> {
    await this.put({ ...keys.snapshot(snapshot.date), ...snapshot });
    if (alsoLatest) await this.put({ ...keys.snapshot("LATEST"), ...snapshot });
  }

  getSnapshot(date: IsoDate | "LATEST"): Promise<SnapshotItem | undefined> {
    return this.get<SnapshotItem>(keys.snapshot(date));
  }

  querySnapshots(from: IsoDate, to: IsoDate): Promise<SnapshotItem[]> {
    return this.queryAll<SnapshotItem>({
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": "PORTFOLIO", ":from": `SNAP#${from}`, ":to": `SNAP#${to}` },
    });
  }

  // --- backfill status and job runs ------------------------------------------------------------

  async putBackfillStatus(item: Omit<BackfillItem, "PK" | "SK" | "updatedAt">): Promise<void> {
    await this.put({ ...keys.backfill(item.isin), ...item, updatedAt: new Date().toISOString() });
  }

  getBackfillStatus(isin: string): Promise<BackfillItem | undefined> {
    return this.get<BackfillItem>(keys.backfill(isin));
  }

  async putJobRun(item: Omit<JobRunItem, "PK" | "SK" | "ttl">): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + 90 * 86_400;
    await this.put({ ...keys.jobRun(item.job, item.startedAt), ...item, ttl });
  }

  listJobRuns(job: string): Promise<JobRunItem[]> {
    return this.queryAll<JobRunItem>({
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `JOB#${job}` },
      ScanIndexForward: false,
    });
  }
}
