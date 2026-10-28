// IBKR Flex Web Service: runs the saved Flex Query (IBKR_FLEX_QUERY_ID) with the token (SST secret IbkrFlexToken) and
// returns the statement's XML. Two calls: SendRequest starts it and answers a reference code; GetStatement returns
// the statement once IBKR has generated it (seconds), a status with error 1019 until then.
// https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service/

import { isFlexStatement, parseFlexReply, type IsoDate } from "@portfolio/core";
import { Resource } from "sst";

const SEND = "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
const HEADERS = { "User-Agent": "portfolio-tracker/1.0 (personal use)" }; // IBKR refuses requests without one
const TIMEOUT_MS = 30_000;
/** Errors worth waiting for: statement being generated (1019), too many requests (1018), service busy (1001, 1021). */
const RETRY_CODES = new Set(["1001", "1018", "1019", "1021"]);

/** The token, or undefined on a stage without one (int: nothing at IBKR is tested there). */
export function flexToken(): string | undefined {
  try {
    return (Resource as unknown as Record<string, { value?: string } | undefined>).IbkrFlexToken?.value || undefined;
  } catch {
    return undefined;
  }
}

const compact = (d: IsoDate) => d.replaceAll("-", "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`IBKR Flex: HTTP ${res.status}`);
  return res.text();
}

/**
 * Runs the query for [from, to] (both business days, at most 365 days apart; without them, the query's own period)
 * and returns the statement's XML. The token never appears in an error.
 */
export async function fetchFlexStatement(opts: { token: string; queryId: string; from?: IsoDate; to?: IsoDate }): Promise<string> {
  const { token, queryId, from, to } = opts;
  const range = from && to ? `&fd=${compact(from)}&td=${compact(to)}` : "";
  const hide = (s: string) => s.replaceAll(token, "***");

  let reply = parseFlexReply(await get(`${SEND}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3${range}`));
  for (let attempt = 1; reply.status !== "Success" && RETRY_CODES.has(reply.errorCode ?? "") && attempt <= 3; attempt++) {
    await sleep(5_000 * attempt);
    reply = parseFlexReply(await get(`${SEND}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3${range}`));
  }
  if (reply.status !== "Success" || !reply.referenceCode) throw new Error(hide(`IBKR Flex SendRequest: ${reply.errorCode ?? reply.status} ${reply.errorMessage ?? ""}`.trim()));

  const statementUrl = reply.url ?? SEND.replace("SendRequest", "GetStatement");
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 2_000 : 3_000 * attempt);
    const body = await get(`${statementUrl}?t=${encodeURIComponent(token)}&q=${reply.referenceCode}&v=3`);
    if (isFlexStatement(body)) return body;
    const status = parseFlexReply(body);
    if (!RETRY_CODES.has(status.errorCode ?? "")) throw new Error(hide(`IBKR Flex GetStatement: ${status.errorCode ?? status.status} ${status.errorMessage ?? ""}`.trim()));
  }
  throw new Error("IBKR Flex GetStatement: the statement wasn't ready after ~90 s");
}
