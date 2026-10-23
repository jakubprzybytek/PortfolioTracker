import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
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
  type BenchmarkPriceItem,
  type QualityReportItem,
  type FxRateItem,
  type HistoryPointItem,
  type InstrumentItem,
  type JobRunItem,
  type NoteItem,
  type PositionDayItem,
  type PriceItem,
  type ReferenceIndexItem,
  type GusCpiItem,
  type GusCpiSeries,
  type RetailSeriesItem,
  type SnapshotItem,
  type TransactionItem,
} from "./items.ts";

const GSI1 = "GSI1";
/** BatchWrites in flight at once (each up to 25 items). */
const BATCH_WRITES_AT_ONCE = 4;

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

  /** Writes in batches of 25, a few at once, retrying unprocessed items. Returns the number of items written. */
  private batchPut(table: Table, items: object[]): Promise<number> {
    return this.batchWrite(table, items.map((Item) => ({ PutRequest: { Item } })));
  }

  private async batchWrite(table: Table, items: ({ PutRequest: { Item: object } } | { DeleteRequest: { Key: object } })[]): Promise<number> {
    const tableName = this.tables[table];
    const batches: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += 25) batches.push(items.slice(i, i + 25));
    const send = async (batch: typeof items) => {
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

  /** Reads by key in batches of 100, retrying unprocessed keys; missing items are left out. */
  private async batchGet<T>(table: Table, all: { PK: string; SK: string }[]): Promise<T[]> {
    const tableName = this.tables[table];
    const out: T[] = [];
    for (let i = 0; i < all.length; i += 100) {
      let requested: Record<string, unknown>[] = all.slice(i, i + 100);
      for (let attempt = 0; requested.length > 0; attempt++) {
        if (attempt > 8) throw new Error(`BatchGet: ${requested.length} keys still unprocessed after ${attempt} attempts`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res = await this.doc.send(new BatchGetCommand({ RequestItems: { [tableName]: { Keys: requested } } }));
        out.push(...((res.Responses?.[tableName] ?? []) as T[]));
        requested = res.UnprocessedKeys?.[tableName]?.Keys ?? [];
      }
    }
    return out;
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

  // --- GUS CPI as published: since December (returns by year, Indicators), year on year (Indicators) ---

  putGusCpi(series: GusCpiSeries, months: { month: string; value: number }[], source: string): Promise<number> {
    const updatedAt = new Date().toISOString();
    const items: GusCpiItem[] = months.map((m) => ({ ...keys.gusCpi(series, m.month), ...m, source, updatedAt }));
    return this.batchPut("market", items);
  }

  deleteGusCpi(series: GusCpiSeries, months: string[]): Promise<number> {
    return this.batchWrite("market", months.map((m) => ({ DeleteRequest: { Key: keys.gusCpi(series, m) } })));
  }

  listGusCpi(series: GusCpiSeries): Promise<GusCpiItem[]> {
    return this.queryAll<GusCpiItem>("market", {
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": series },
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

  // --- data quality (the `quality` job, the Status page) ---------------------------------------------

  putQualityReport(report: Omit<QualityReportItem, "PK" | "SK">): Promise<void> {
    return this.put("market", { PK: "QUALITY", SK: "LATEST", ...report });
  }

  getQualityReport(): Promise<QualityReportItem | undefined> {
    return this.get<QualityReportItem>("market", { PK: "QUALITY", SK: "LATEST" });
  }

  // --- benchmarks (Performance view) ---------------------------------------------------------------

  putBenchmarkPrices(items: Omit<BenchmarkPriceItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut("market", items.map((p) => ({ ...keys.benchmarkPrice(p.id, p.date), ...p })));
  }

  /** Closes of one benchmark in [from, to], oldest first. */
  queryBenchmarkPrices(id: string, from: IsoDate, to: IsoDate): Promise<BenchmarkPriceItem[]> {
    return this.queryAll<BenchmarkPriceItem>("market", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `BENCH#${id}`, ":from": from, ":to": to },
    });
  }

  /** The latest stored close, if any. */
  async latestBenchmarkPrice(id: string): Promise<BenchmarkPriceItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.market,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `BENCH#${id}` },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return res.Items?.[0] as BenchmarkPriceItem | undefined;
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

  // --- settings (your choices, e.g. the hold-or-sell assumptions; transactions table) ----------------

  async getSetting<T>(name: string): Promise<T | undefined> {
    return (await this.get<{ value: T }>("transactions", keys.setting(name)))?.value;
  }

  putSetting<T>(name: string, value: T): Promise<void> {
    return this.put("transactions", { ...keys.setting(name), value, updatedAt: new Date().toISOString() });
  }

  /** Sets one field of a stored setting's value; does nothing when the setting isn't there (deleted meanwhile). */
  async setSettingField(name: string, field: string, value: unknown): Promise<void> {
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tables.transactions,
          Key: keys.setting(name),
          UpdateExpression: "SET #v.#f = :x",
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeNames: { "#v": "value", "#f": field },
          ExpressionAttributeValues: { ":x": value },
        }),
      );
    } catch (e) {
      if ((e as Error).name !== "ConditionalCheckFailedException") throw e;
    }
  }

  async deleteSetting(name: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.tables.transactions, Key: keys.setting(name) }));
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

  getSnapshot(date: IsoDate | "LATEST"): Promise<SnapshotItem | undefined> {
    return this.get<SnapshotItem>("holdings", keys.snapshot(date));
  }

  /** The stored snapshots of these days (batched reads); days without one are left out. */
  getSnapshots(dates: IsoDate[]): Promise<SnapshotItem[]> {
    return this.batchGet<SnapshotItem>("holdings", dates.map((d) => keys.snapshot(d)));
  }

  querySnapshots(from: IsoDate, to: IsoDate): Promise<SnapshotItem[]> {
    return this.queryAll<SnapshotItem>("holdings", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": "PORTFOLIO", ":from": `SNAP#${from}`, ":to": `SNAP#${to}` },
    });
  }

  // --- history (a chart point per day, one item per position per day) --------------------------

  /**
   * What a revaluation writes for a run of days, in as few BatchWrites as possible: the changed days' snapshots (and
   * SNAP#LATEST), each changed day's position days (pass only the holdings whose day changed) and the days of positions
   * gone. Chart points go separately (putHistoryPoints), after these. Returns the number of items written.
   */
  writeValuedDays(days: {
    snapshots: Omit<SnapshotItem, "PK" | "SK">[];
    latest?: Omit<SnapshotItem, "PK" | "SK">;
    positionDays: { date: IsoDate; holdings: SnapshotItem["holdings"] }[];
    gone: { account: string; isin: string; date: IsoDate }[];
  }): Promise<number> {
    const positions = days.positionDays.flatMap(({ date, holdings }) =>
      holdings.map((h): PositionDayItem => ({ ...keys.positionDay(h.account, h.isin, date), account: h.account, isin: h.isin, date, quantity: h.quantity, value: h.value, cost: h.cost })),
    );
    return this.batchWrite("holdings", [
      ...days.snapshots.map((s) => ({ PutRequest: { Item: { ...keys.snapshot(s.date), ...s } } })),
      ...(days.latest ? [{ PutRequest: { Item: { ...keys.snapshot("LATEST"), ...days.latest } } }] : []),
      ...positions.map((Item) => ({ PutRequest: { Item } })),
      ...days.gone.map((d) => ({ DeleteRequest: { Key: keys.positionDay(d.account, d.isin, d.date) } })),
    ]);
  }

  /** Chart points (`HISTORY`), batched. */
  putHistoryPoints(points: Omit<HistoryPointItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut("holdings", points.map((p) => ({ ...keys.historyPoint(p.date), ...p })));
  }

  queryHistoryPoints(from: IsoDate, to: IsoDate): Promise<HistoryPointItem[]> {
    return this.queryAll<HistoryPointItem>("holdings", {
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": "HISTORY", ":from": from, ":to": to },
    });
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

  /** The backfill status of each of these instruments that has one, by ISIN (batched reads). */
  async listBackfillStatuses(isins: string[]): Promise<Map<string, BackfillItem>> {
    const items = await this.batchGet<BackfillItem>("market", isins.map((isin) => keys.backfill(isin)));
    return new Map(items.map((i) => [i.isin, i]));
  }

  async putJobRun(item: Omit<JobRunItem, "PK" | "SK" | "ttl">): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + 90 * 86_400;
    await this.put("market", { ...keys.jobRun(item.job, item.startedAt), ...item, ttl });
  }

  /** The job's most recent run (one item read, not its 90 days of runs). */
  async latestJobRun(job: string): Promise<JobRunItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tables.market,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": `JOB#${job}` },
        ScanIndexForward: false,
        Limit: 1,
      }),
    );
    return res.Items?.[0] as JobRunItem | undefined;
  }
}
