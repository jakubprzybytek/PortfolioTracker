import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { IsoDate } from "../dates.ts";
import type { ReferenceIndexMonth } from "../bonds/izIndex.ts";
import {
  keys,
  type AccountItem,
  type BackfillItem,
  type CouponPeriodItem,
  type FxRateItem,
  type InstrumentItem,
  type JobRunItem,
  type NoteItem,
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
  private batchPut(table: Table, items: object[]): Promise<number> {
    return this.batchWrite(table, items.map((Item) => ({ PutRequest: { Item } })));
  }

  private batchDelete(table: Table, keys: { PK: string; SK: string }[]): Promise<number> {
    return this.batchWrite(table, keys.map((Key) => ({ DeleteRequest: { Key } })));
  }

  private async batchWrite(table: Table, all: ({ PutRequest: { Item: object } } | { DeleteRequest: { Key: object } })[]): Promise<number> {
    const tableName = this.tables[table];
    const items = all;
    for (let i = 0; i < items.length; i += 25) {
      let requests = items.slice(i, i + 25);
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt > 8) throw new Error(`BatchWrite: ${requests.length} items still unprocessed after ${attempt} attempts`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res = await this.doc.send(new BatchWriteCommand({ RequestItems: { [tableName]: requests } }));
        requests = (res.UnprocessedItems?.[tableName] ?? []) as typeof requests;
      }
    }
    return items.length;
  }

  private async scanAll<T>(table: Table, input: Omit<ScanCommandInput, "TableName">): Promise<T[]> {
    const out: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.doc.send(new ScanCommand({ TableName: this.tables[table], ...input, ExclusiveStartKey }));
      out.push(...((res.Items ?? []) as T[]));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
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

  async deletePrice(isin: string, venue: string, date: IsoDate): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tables.market, Key: keys.price(isin, venue, date) }));
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

  // --- exchange rates (NBP table A) ------------------------------------------------------------

  putFxRates(items: Omit<FxRateItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut("market", items.map((r) => ({ ...keys.fxRate(r.currency, r.date), ...r })));
  }

  /** Rates of one currency in [from, to], oldest first. */
  queryFxRates(currency: string, from: IsoDate, to: IsoDate): Promise<FxRateItem[]> {
    return this.queryAll<FxRateItem>("market", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `FX#${currency}`, ":from": from, ":to": to },
    });
  }

  /** The latest rate on or before `date`. */
  async latestFxRate(currency: string, date: IsoDate): Promise<FxRateItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.market,
        KeyConditionExpression: "PK = :pk AND SK <= :to",
        ExpressionAttributeValues: { ":pk": `FX#${currency}`, ":to": date },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return res.Items?.[0] as FxRateItem | undefined;
  }

  // --- retail bond series (Ministry file) -------------------------------------------------------

  putRetailSeries(series: Omit<RetailSeriesItem, "PK" | "SK" | "source" | "updatedAt">[], source: string): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut("market", series.map((s) => ({ ...keys.retailSeries(s.series), ...s, source, updatedAt })));
  }

  getRetailSeries(series: string): Promise<RetailSeriesItem | undefined> {
    return this.get<RetailSeriesItem>("market", keys.retailSeries(series));
  }

  // --- coupon periods of corporate bonds ---------------------------------------------------------

  putCouponPeriods(items: Omit<CouponPeriodItem, "PK" | "SK" | "updatedAt">[]): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut("market", items.map((i) => ({ ...keys.couponPeriod(i.isin, i.start), ...i, updatedAt })));
  }

  /** A bond's periods, oldest first. */
  listCouponPeriods(isin: string): Promise<CouponPeriodItem[]> {
    return this.queryAll<CouponPeriodItem>("market", {
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `INST#${isin}`, ":sk": "COUPON#" },
    });
  }

  async deleteCouponPeriod(isin: string, start: IsoDate): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tables.market, Key: keys.couponPeriod(isin, start) }));
  }

  // --- transactions ----------------------------------------------------------------------------

  putTransactions(items: Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(
      "transactions",
      items.map((t) => ({ ...keys.transaction(t.account, t.date, t.id), GSI1PK: "TX", GSI1SK: `${t.date}#${t.id}`, ...t })),
    );
  }

  /** One transaction of an account by its id (any date). */
  async findTransaction(account: string, id: string): Promise<TransactionItem | undefined> {
    const items = await this.queryAll<TransactionItem>("transactions", {
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      FilterExpression: "id = :id",
      ExpressionAttributeValues: { ":pk": `ACCT#${account}`, ":sk": "TX#", ":id": id },
    });
    return items[0];
  }

  async deleteTransaction(t: Pick<TransactionItem, "account" | "date" | "id">): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tables.transactions, Key: keys.transaction(t.account, t.date, t.id) }));
  }

  /** Replaces the metadata of the given accounts (others are left alone). */
  putAccounts(accounts: { account: string; incomplete?: string[]; baseCurrency?: string }[]): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut(
      "transactions",
      accounts.map((a) => ({
        ...keys.account(a.account),
        GSI1PK: "ACCOUNT",
        GSI1SK: a.account,
        account: a.account,
        ...(a.incomplete?.length ? { incomplete: a.incomplete } : {}),
        ...(a.baseCurrency && a.baseCurrency !== "PLN" ? { baseCurrency: a.baseCurrency } : {}),
        updatedAt,
      })),
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

  // --- notes ---------------------------------------------------------------------------------

  putNotes(notes: Omit<NoteItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(
      "transactions",
      notes.map((n) => ({ ...keys.note(n.id), GSI1PK: "NOTE", GSI1SK: n.id, ...n })),
    );
  }

  getNote(id: string): Promise<NoteItem | undefined> {
    return this.get<NoteItem>("transactions", keys.note(id));
  }

  /** All notes (any order). */
  listNotes(): Promise<NoteItem[]> {
    return this.queryAll<NoteItem>("transactions", {
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": "NOTE" },
    });
  }

  async deleteNote(id: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tables.transactions, Key: keys.note(id) }));
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

  /** Removes days of positions (e.g. one that no longer exists after a transaction was edited or deleted). */
  deletePositionDays(days: { account: string; isin: string; date: IsoDate }[]): Promise<number> {
    return this.batchDelete("holdings", days.map((d) => keys.positionDay(d.account, d.isin, d.date)));
  }

  /** Every position day in the table (a full scan: for the one-off cleanup of days left by older versions). */
  scanPositionDays(): Promise<Pick<PositionDayItem, "account" | "isin" | "date">[]> {
    return this.scanAll<Pick<PositionDayItem, "account" | "isin" | "date">>("holdings", {
      FilterExpression: "begins_with(PK, :pos)",
      ExpressionAttributeValues: { ":pos": "POS#" },
      ProjectionExpression: "account, isin, #d",
      ExpressionAttributeNames: { "#d": "date" },
    });
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
