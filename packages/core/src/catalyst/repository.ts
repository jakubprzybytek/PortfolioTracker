// Access to the Catalyst module's table (Docs/catalyst.md, "Storage"). Separate from PT's Repository: the module's
// functions link only this table.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import type { IsoDate } from "../dates.ts";
import { JobRunStore } from "../db/jobRuns.ts";
import type { InterestPeriod } from "../bonds/couponPeriods.ts";
import { catalystKeys, type CatalystBondItem, type CatalystCouponItem, type CatalystEntityItem, type CatalystEventItem, type CatalystFilingItem, type CatalystKnownItem, type CatalystYearItem, type CatalystExitsNowItem, type CatalystLinkItem, type CatalystMarkingItem, type CatalystNameItem, type CatalystCurveItem, type CatalystDayItem, type CatalystQuoteDayItem, type CatalystQuoteItem, type CatalystScreenItem, type CatalystSessionItem, type CatalystTermsItem } from "./items.ts";
import type { ScreenRow } from "./screen.ts";
import type { FinancialYear } from "./financials.ts";

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

  putQuotes(items: Omit<CatalystQuoteItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut(items.map((q) => ({ ...catalystKeys.quote(q.isin, q.date, q.market), ...q })));
  }

  /** Bonds whose code starts with `prefix` (one query on the index): an issuer's bonds until companies are known. */
  listBondsByPrefix(prefix: string): Promise<CatalystBondItem[]> {
    return this.queryAll<CatalystBondItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t AND begins_with(GSI1SK, :p)", ExpressionAttributeValues: { ":t": "BOND", ":p": prefix } });
  }

  /** A bond's last session (any market), or undefined. */
  async lastSession(isin: string): Promise<CatalystSessionItem | undefined> {
    const res = await this.doc.send(
      new QueryCommand({ TableName: this.table(), KeyConditionExpression: "PK = :pk AND begins_with(SK, :d)", ExpressionAttributeValues: { ":pk": `BOND#${isin}`, ":d": "D#" }, ScanIndexForward: false, Limit: 1 }),
    );
    return res.Items?.[0] as CatalystSessionItem | undefined;
  }

  putEvents(items: Omit<CatalystEventItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut(items.map((e) => ({ ...catalystKeys.event(e.isin, e.published, e.action), ...e })));
  }

  /** A bond's GPW measures, oldest first. */
  listEvents(isin: string): Promise<CatalystEventItem[]> {
    return this.queryAll<CatalystEventItem>({ KeyConditionExpression: "PK = :pk AND begins_with(SK, :e)", ExpressionAttributeValues: { ":pk": `BOND#${isin}`, ":e": "EVENT#" } });
  }

  listMarkings(): Promise<CatalystMarkingItem[]> {
    return this.queryAll<CatalystMarkingItem>({ KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": "MARKS" } });
  }

  putMarkings(items: Omit<CatalystMarkingItem, "PK" | "SK">[]): Promise<number> {
    return this.batchPut(items.map((m) => ({ ...catalystKeys.marking(m.issuer, m.marking), ...m })));
  }

  getExitsNow(): Promise<CatalystExitsNowItem | undefined> {
    return this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.exitsNow() })).then((r) => r.Item as CatalystExitsNowItem | undefined);
  }

  async putExitsNow(item: Omit<CatalystExitsNowItem, "PK" | "SK">): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.exitsNow(), ...item } }));
  }

  /** Every bond's issuer link (one query on the index). */
  listLinks(): Promise<CatalystLinkItem[]> {
    return this.queryAll<CatalystLinkItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "LINK" } });
  }

  getLink(isin: string): Promise<CatalystLinkItem | undefined> {
    return this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.link(isin) })).then((r) => r.Item as CatalystLinkItem | undefined);
  }

  putLinks(items: Omit<CatalystLinkItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(items.map((l) => ({ ...catalystKeys.link(l.isin), GSI1PK: "LINK", GSI1SK: l.isin, ...l })));
  }

  listNames(): Promise<CatalystNameItem[]> {
    return this.queryAll<CatalystNameItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "NAME" } });
  }

  getName(name: string): Promise<CatalystNameItem | undefined> {
    return this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.name(name) })).then((r) => r.Item as CatalystNameItem | undefined);
  }

  putNames(items: Omit<CatalystNameItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(items.map((n) => ({ ...catalystKeys.name(n.name), GSI1PK: "NAME", GSI1SK: n.name, ...n })));
  }

  listEntities(): Promise<CatalystEntityItem[]> {
    return this.queryAll<CatalystEntityItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "ENTITY" } });
  }

  getEntity(entityId: string): Promise<CatalystEntityItem | undefined> {
    return this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.entity(entityId) })).then((r) => r.Item as CatalystEntityItem | undefined);
  }

  putEntities(items: Omit<CatalystEntityItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(items.map((e) => ({ ...catalystKeys.entity(e.entityId), GSI1PK: "ENTITY", GSI1SK: e.shortName, ...e })));
  }

  /** A company's financial years (current versions), oldest first. */
  listYears(entityId: string): Promise<CatalystYearItem[]> {
    return this.queryAll<CatalystYearItem>({ KeyConditionExpression: "PK = :pk AND begins_with(SK, :f)", ExpressionAttributeValues: { ":pk": `ENTITY#${entityId}`, ":f": "FIN#" } });
  }

  /** Stores years; `replaced` rows are kept under FINOLD#. */
  async putYears(rows: FinancialYear[], replaced: FinancialYear[] = []): Promise<number> {
    const items = [
      ...replaced.map((r) => ({ ...r, ...catalystKeys.replacedYear(r.entityId, r.period, r.importedAt) })),
      ...rows.map((r) => ({ ...r, ...catalystKeys.year(r.entityId, r.period) })),
    ];
    return this.batchPut(items);
  }

  listFilings(entityId: string): Promise<CatalystFilingItem[]> {
    return this.queryAll<CatalystFilingItem>({ KeyConditionExpression: "PK = :pk AND begins_with(SK, :f)", ExpressionAttributeValues: { ":pk": `ENTITY#${entityId}`, ":f": "FILING#" } });
  }

  async putFiling(item: Omit<CatalystFilingItem, "PK" | "SK">): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.filing(item.entityId, item.sha256), ...item } }));
  }

  listKnown(): Promise<CatalystKnownItem[]> {
    return this.queryAll<CatalystKnownItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "KNOWN" } });
  }

  putKnown(items: Omit<CatalystKnownItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">[]): Promise<number> {
    return this.batchPut(items.map((k) => ({ ...catalystKeys.known(k.entityId, k.period), GSI1PK: "KNOWN", GSI1SK: `${k.entityId}#${k.period}`, ...k })));
  }

  /** Every bond's terms (one query on the index). */
  listTerms(): Promise<CatalystTermsItem[]> {
    return this.queryAll<CatalystTermsItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "TERMS" } });
  }

  async putTerms(item: Omit<CatalystTermsItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.terms(item.isin), GSI1PK: "TERMS", GSI1SK: item.isin, ...item } }));
  }

  /** A bond's interest periods, oldest first. */
  async listCoupons(isin: string): Promise<InterestPeriod[]> {
    const items = await this.queryAll<CatalystCouponItem>({ KeyConditionExpression: "PK = :pk AND begins_with(SK, :c)", ExpressionAttributeValues: { ":pk": `BOND#${isin}`, ":c": "COUPON#" } });
    return items.map(({ PK: _p, SK: _s, updatedAt: _u, ...p }) => p);
  }

  putCoupons(periods: InterestPeriod[]): Promise<number> {
    const updatedAt = new Date().toISOString();
    return this.batchPut(periods.map((p) => ({ ...catalystKeys.coupon(p.isin, p.start), ...p, updatedAt })));
  }

  /** Every screen row (one query on the index; ended bonds' last rows too: the bond's status decides). */
  listScreen(): Promise<CatalystScreenItem[]> {
    return this.queryAll<CatalystScreenItem>({ IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :t", ExpressionAttributeValues: { ":t": "SCREEN" } });
  }

  putScreen(rows: ScreenRow[]): Promise<number> {
    const computedAt = new Date().toISOString();
    return this.batchPut(rows.map((r) => ({ ...catalystKeys.screen(r.isin), GSI1PK: "SCREEN", GSI1SK: r.code, ...r, computedAt })));
  }

  async putCurve(item: Omit<CatalystCurveItem, "PK" | "SK">): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.curve(item.date), ...item } }));
  }

  /** The latest curve, if any. */
  async latestCurve(): Promise<CatalystCurveItem | undefined> {
    const res = await this.doc.send(new QueryCommand({ TableName: this.table(), KeyConditionExpression: "PK = :pk", ExpressionAttributeValues: { ":pk": "CURVE#PLGOV" }, ScanIndexForward: false, Limit: 1 }));
    return res.Items?.[0] as CatalystCurveItem | undefined;
  }

  async getSetting<T>(name: string): Promise<T | undefined> {
    const res = await this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.setting(name) }));
    return res.Item?.["value"] as T | undefined;
  }

  async putSetting(name: string, value: unknown): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.setting(name), value, updatedAt: new Date().toISOString() } }));
  }

  getQuoteDay(date: IsoDate): Promise<CatalystQuoteDayItem | undefined> {
    return this.doc.send(new GetCommand({ TableName: this.table(), Key: catalystKeys.quoteDay(date) })).then((r) => r.Item as CatalystQuoteDayItem | undefined);
  }

  async putQuoteDay(item: Omit<CatalystQuoteDayItem, "PK" | "SK">): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table(), Item: { ...catalystKeys.quoteDay(item.date), ...item } }));
  }

  /** A bond's end-of-session quotes from `from` to `to` (inclusive), every market, oldest first. */
  listQuotes(isin: string, from: IsoDate, to: IsoDate): Promise<CatalystQuoteItem[]> {
    return this.queryAll<CatalystQuoteItem>({
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
      ExpressionAttributeValues: { ":pk": `BOND#${isin}`, ":from": `Q#${from}`, ":to": `Q#${to}#~` },
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
