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
  type AccountItem,
  type BackfillItem,
  type CouponRateItem,
  type InstrumentItem,
  type JobRunItem,
  type PositionDayItem,
  type PriceItem,
  type ReferenceIndexItem,
  type RetailSeriesItem,
  type SnapshotItem,
  type TransactionItem,
} from "./items.ts";

const GSI1 = "GSI1";

/**
 * Table names, read on every call. A function linked to only some tables can pass getters,
 * so a name is resolved only when that table is actually used.
 */
export interface TableNames {
  readonly market: string;
  readonly transactions: string;
  readonly holdings: string;
}

type Table = keyof TableNames;

/** Typed access to the three tables (see Docs/data-storage.md). Table names are injected so core stays free of SST imports. */
export class Repository {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tables: TableNames;

  constructor(tables: TableNames, client: DynamoDBClient = new DynamoDBClient({})) {
    this.tables = tables;
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  // --- generic helpers -------------------------------------------------------------------------

  private async get<T>(table: Table, key: { PK: string; SK: string }): Promise<T | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.tables[table], Key: key }));
    return res.Item as T | undefined;
  }

  private async put(table: Table, item: object): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tables[table], Item: item }));
  }

  /** Writes in batches of 25, retrying unprocessed items. Returns the number of items written. */
  private async batchPut(table: Table, items: object[]): Promise<number> {
    const tableName = this.tables[table];
    for (let i = 0; i < items.length; i += 25) {
      let requests = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt > 8) throw new Error(`BatchWrite: ${requests.length} items still unprocessed after ${attempt} attempts`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res = await this.doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
        requests = (res.UnprocessedItems?.[tableName] ?? []) as typeof requests;
      }
    }
    return items.length;
  }

  private async queryAll<T>(table: Table, input: Omit<QueryCommandInput, "TableName">): Promise<T[]> {
    const out: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(new QueryCommand({ TableName: this.tables[table], ...input, ExclusiveStartKey }));
      out.push(...((res.Items ?? []) as T[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  // --- instruments -----------------------------------------------------------------------------

  async putInstrument(item: Omit<InstrumentItem, "PK" | "SK" | "GSI1PK" | "GSI1SK" | "updatedAt">): Promise<InstrumentItem> {
    const full: InstrumentItem = { ...keys.instrument(item.isin), GSI1PK: "INSTRUMENT", GSI1SK: item.isin, ...item, updatedAt: new Date().toISOString() };
    await this.put("market", full);
    return full;
  }

  getInstrument(isin: string): Promise<InstrumentItem | undefined> {
    return this.get<InstrumentItem>("market", keys.instrument(isin));
  }

  listInstruments(): Promise<InstrumentItem[]> {
    return this.queryAll<InstrumentItem>("market", {
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "INSTRUMENT" },
    });
  }

  // --- prices ----------------------------------------------------------------------------------

  putPrices(items: PriceItem[]): Promise<number> {
    return this.batchPut("market", items);
  }

  queryPrices(isin: string, venue: string, from: IsoDate, to: IsoDate): Promise<PriceItem[]> {
    const { PK, SK } = keys.pricePrefix(isin, venue);
    return this.queryAll<PriceItem>("market", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": PK, ":from": `${SK}${from}`, ":to": `${SK}${to}` },
    });
  }

  /** The latest price on or before `date`. */
  async latestPrice(isin: string, venue: string, date: IsoDate): Promise<PriceItem | undefined> {
    const { PK, SK } = keys.pricePrefix(isin, venue);
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.market,
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
    const items = await this.queryAll<{ SK: string }>("market", {
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
    return this.batchPut("market", items);
  }

  listReferenceIndex(): Promise<ReferenceIndexItem[]> {
    return this.queryAll<ReferenceIndexItem>("market", {
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": "CPI_REF" },
    });
  }

  // --- retail bond series (Ministry file) -------------------------------------------------------

  putRetailSeries(series: Omit<RetailSeriesItem, "PK" | "SK" | "source" | "updatedAt">[], source: string): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut("market", series.map((s) => ({ ...keys.retailSeries(s.series), ...s, source, updatedAt })));
  }

  getRetailSeries(series: string): Promise<RetailSeriesItem | undefined> {
    return this.get<RetailSeriesItem>("market", keys.retailSeries(series));
  }

  // --- floating coupon rates -------------------------------------------------------------------

  putCouponRates(items: Omit<CouponRateItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut("market", items.map((i) => ({ ...keys.couponRate(i.isin, i.periodStart), ...i })));
  }

  listCouponRates(isin: string): Promise<CouponRateItem[]> {
    return this.queryAll<CouponRateItem>("market", {
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `INST#${isin}`, ":sk": "COUPON#" },
    });
  }

  // --- transactions ----------------------------------------------------------------------------

  putTransactions(items: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(
      "transactions",
      items.map((t) => ({ ...keys.transaction(t.account, t.date, t.id), GSI1PK: "TX", GSI1SK: `${t.date}#${t.id}`, ...t })),
    );
  }

  /** Replaces the metadata of the given accounts (others are left alone). */
  putAccounts(accounts: { account: string; incomplete?: string[] }[]): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut(
      "transactions",
      accounts.map((a) => ({ ...keys.account(a.account), GSI1PK: "ACCOUNT", GSI1SK: a.account, account: a.account, ...(a.incomplete?.length ? { incomplete: a.incomplete } : {}), updatedAt })),
    );
  }

  listAccounts(): Promise<AccountItem[]> {
    return this.queryAll<AccountItem>("transactions", {
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "ACCOUNT" },
    });
  }

  /** All transactions, oldest first. */
  listTransactions(): Promise<TransactionItem[]> {
    return this.queryAll<TransactionItem>("transactions", {
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "TX" },
    });
  }

  // --- snapshots -------------------------------------------------------------------------------

  async putSnapshot(snapshot: Omit<SnapshotItem, "PK" | "SK">, alsoLatest: boolean): Promise<void> {
    await this.put("holdings", { ...keys.snapshot(snapshot.date), ...snapshot });
    if (alsoLatest) await this.put("holdings", { ...keys.snapshot("LATEST"), ...snapshot });
  }

  getSnapshot(date: IsoDate | "LATEST"): Promise<SnapshotItem | undefined> {
    return this.get<SnapshotItem>("holdings", keys.snapshot(date));
  }

  querySnapshots(from: IsoDate, to: IsoDate): Promise<SnapshotItem[]> {
    return this.queryAll<SnapshotItem>("holdings", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": "PORTFOLIO", ":from": `SNAP#${from}`, ":to": `SNAP#${to}` },
    });
  }

  // --- position history (one item per position per day) --------------------------------------

  /** Writes each holding of a snapshot as that position's value on the snapshot's day. */
  putPositionDays(snapshot: Pick<SnapshotItem, "date" | "holdings">): Promise<number> {
    return this.batchPut(
      "holdings",
      snapshot.holdings.map((h): PositionDayItem => ({
        ...keys.positionDay(h.account, h.isin, snapshot.date),
        account: h.account,
        isin: h.isin,
        date: snapshot.date,
        quantity: h.quantity,
        value: h.value,
        cost: h.cost,
      })),
    );
  }

  queryPositionDays(account: string, isin: string, from: IsoDate, to: IsoDate): Promise<PositionDayItem[]> {
    return this.queryAll<PositionDayItem>("holdings", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `POS#${account}#${isin}`, ":from": from, ":to": to },
    });
  }

  // --- backfill status and job runs ------------------------------------------------------------

  async putBackfillStatus(item: Omit<BackfillItem, "PK" | "SK" | "updatedAt">): Promise<void> {
    await this.put("market", { ...keys.backfill(item.isin), ...item, updatedAt: new Date().toISOString() });
  }

  getBackfillStatus(isin: string): Promise<BackfillItem | undefined> {
    return this.get<BackfillItem>("market", keys.backfill(isin));
  }

  async putJobRun(item: Omit<JobRunItem, "PK" | "SK" | "ttl">): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + 90 * 86_400;
    await this.put("market", { ...keys.jobRun(item.job, item.startedAt), ...item, ttl });
  }

  listJobRuns(job: string): Promise<JobRunItem[]> {
    return this.queryAll<JobRunItem>("market", {
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `JOB#${job}` },
      ScanIndexForward: false,
    });
  }
}
