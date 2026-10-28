// IBKR Flex Web Service: the replies of its two calls and the positions statement the `eod-ibkr` job asks for (an
// Activity Flex Query with Open Positions and Prior Period Positions, XML). Only prices are taken from it: IBKR's mark
// price per position and day, % of nominal for bonds and bills, in the instrument's currency. Transactions still come
// from the app (Docs/data-sources.md, "IBKR Flex Web Service").

import { addDays, type IsoDate } from "../dates.ts";
import type { InstrumentItem, PriceItem } from "../db/items.ts";
import type { PricePoint } from "./pricePath.ts";

/** Reply to SendRequest (a reference code to collect the statement with) or to GetStatement while it isn't ready. */
export interface FlexReply {
  status: string; // Success, Warn, Fail
  referenceCode?: string;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** A position held at the end of the statement's last day. */
export interface FlexOpenPosition {
  isin: string;
  conid: string;
  symbol: string;
  description: string;
  assetCategory: string; // BOND, BILL, STK …
  currency: string;
  reportDate: IsoDate;
  quantity: number; // nominal for bonds and bills
  markPrice: number;
  positionValue: number | null;
  accruedInterest: number | null;
}

/** IBKR's price of a position held on a day of the statement's period. */
export interface FlexDailyPrice {
  isin: string;
  conid: string;
  assetCategory: string;
  currency: string;
  date: IsoDate;
  price: number;
}

export interface FlexStatement {
  from: IsoDate;
  to: IsoDate;
  open: FlexOpenPosition[];
  prices: FlexDailyPrice[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]!] = decode(m[2]!);
  return out;
}

/** The self-closing elements of one kind, as attribute maps. */
const elements = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}\\s([^>]*?)/?>`, "g"))].map((m) => attributes(m[1]!));

const text = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decode(m[1]!.trim()) : undefined;
};

/** "2026-10-27" or "20261027" (both are date formats a Flex Query can be set to). */
function isoDate(s: string | undefined, what: string): IsoDate {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s ?? "");
  if (!m) throw new Error(`IBKR Flex: ${what} "${s ?? ""}" is not a date`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function number(s: string | undefined, what: string): number {
  const n = Number(s);
  if (s === undefined || s === "" || !Number.isFinite(n)) throw new Error(`IBKR Flex: ${what} "${s ?? ""}" is not a number`);
  return n;
}

const optionalNumber = (s: string | undefined) => (s === undefined || s === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** The reply of SendRequest, or of GetStatement when it returns a status instead of the statement. */
export function parseFlexReply(xml: string): FlexReply {
  if (!xml.includes("<FlexStatementResponse")) throw new Error(`IBKR Flex: unexpected reply: ${xml.slice(0, 200)}`);
  const reply: FlexReply = { status: text(xml, "Status") ?? "" };
  for (const [key, tag] of [["referenceCode", "ReferenceCode"], ["url", "Url"], ["errorCode", "ErrorCode"], ["errorMessage", "ErrorMessage"]] as const) {
    const v = text(xml, tag);
    if (v) reply[key] = v;
  }
  return reply;
}

/** Whether GetStatement returned the statement (rather than a status: not ready yet, or an error). */
export const isFlexStatement = (xml: string) => xml.includes("<FlexQueryResponse");

/** The positions statement: open positions at the end and the daily prices of every position held in the period. */
export function parseFlexStatement(xml: string): FlexStatement {
  if (!isFlexStatement(xml)) throw new Error(`IBKR Flex: not a statement: ${xml.slice(0, 200)}`);
  const statements = elements(xml, "FlexStatement");
  if (statements.length !== 1) throw new Error(`IBKR Flex: expected one account's statement, got ${statements.length}`);
  const s = statements[0]!;
  const open = elements(xml, "OpenPosition")
    // One row per position (Summary); a query set to lots would repeat it per lot.
    .filter((a) => !a.levelOfDetail || a.levelOfDetail === "SUMMARY")
    .map(
      (a): FlexOpenPosition => ({
        isin: a.isin ?? "",
        conid: a.conid ?? "",
        symbol: a.symbol ?? "",
        description: a.description ?? "",
        assetCategory: a.assetCategory ?? "",
        currency: a.currency ?? "",
        reportDate: isoDate(a.reportDate, "reportDate"),
        quantity: number(a.position, `position of ${a.isin}`),
        markPrice: number(a.markPrice, `markPrice of ${a.isin}`),
        positionValue: optionalNumber(a.positionValue),
        accruedInterest: optionalNumber(a.accruedInt),
      }),
    );
  const prices = elements(xml, "PriorPeriodPosition").map(
    (a): FlexDailyPrice => ({
      isin: a.isin ?? "",
      conid: a.conid ?? "",
      assetCategory: a.assetCategory ?? "",
      currency: a.currency ?? "",
      date: isoDate(a.date, "date"),
      price: number(a.price, `price of ${a.isin}`),
    }),
  );
  return { from: isoDate(s.fromDate, "fromDate"), to: isoDate(s.toDate, "toDate"), open, prices };
}

/** The instrument's IBKR id (conid) in its `sourceIds`. */
export const IBKR_SOURCE_ID = "ibkr";

/**
 * The instrument's daily prices in a statement, matched by ISIN (or IBKR's conid), as price items of its venue. Open
 * positions add the last day's mark when the prior-period section doesn't have it. A price in another currency than
 * the instrument's is an error: it would be valued wrong.
 */
export function ibkrPrices(inst: Pick<InstrumentItem, "isin" | "venue" | "currency" | "sourceIds">, statement: FlexStatement, fetchedAt: string): PriceItem[] {
  const conid = inst.sourceIds[IBKR_SOURCE_ID];
  const mine = (p: { isin: string; conid: string }) => p.isin === inst.isin || (!!conid && p.conid === conid);
  const byDate = new Map<IsoDate, { price: number; currency: string }>();
  for (const p of statement.prices.filter(mine)) byDate.set(p.date, { price: p.price, currency: p.currency });
  for (const p of statement.open.filter(mine)) if (!byDate.has(p.reportDate)) byDate.set(p.reportDate, { price: p.markPrice, currency: p.currency });
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { price, currency }]) => {
      if (currency !== inst.currency) throw new Error(`IBKR Flex ${inst.isin}: priced in ${currency}, the instrument in ${inst.currency}`);
      return priceItem(inst, date, price, "ibkr", fetchedAt);
    });
}

/**
 * Days before IBKR's first price that the position was already held: IBKR reports a position from its settlement
 * day, the app holds it from the trade day. Those days get the trade price (the instrument's `pricePath` points),
 * so the position isn't left without a value on the day it was bought.
 */
export function tradeDayPrices(
  inst: Pick<InstrumentItem, "isin" | "venue" | "currency" | "pricePath">,
  firstIbkrDate: IsoDate | undefined,
  fetchedAt: string,
): PriceItem[] {
  const before = (inst.pricePath ?? []).filter((p: PricePoint) => !firstIbkrDate || p.date < firstIbkrDate);
  // Only trades shortly before IBKR's first price (settlement is T+1/T+2; a week covers holidays), not maturity.
  const recent = firstIbkrDate ? before.filter((p) => p.date >= addDays(firstIbkrDate, -7)) : [];
  return recent.map((p) => priceItem(inst, p.date, p.price, "trade", fetchedAt));
}

function priceItem(inst: Pick<InstrumentItem, "isin" | "venue" | "currency">, date: IsoDate, close: number, source: string, fetchedAt: string): PriceItem {
  return {
    PK: `INST#${inst.isin}`,
    SK: `PX#${inst.venue}#${date}`,
    isin: inst.isin,
    venue: inst.venue,
    date,
    open: null,
    high: null,
    low: null,
    close,
    volume: 0,
    trades: 0,
    turnover: 0,
    traded: true,
    currency: inst.currency,
    source,
    fetchedAt,
    status: "final",
  };
}
