// Which days a revaluation values: each request asks for a range; requests waiting together make one run over the
// union of theirs.

import type { IsoDate } from "../dates.ts";
import type { TransactionItem } from "../db/items.ts";
import { firstTransactionDate } from "./positions.ts";

export interface ValuationRequest {
  from?: IsoDate;
  to?: IsoDate;
  reason?: string;
  /** Write every day even if unchanged (e.g. after a change to what a position day stores). */
  force?: boolean;
  /** Without `from`: from the first transaction of these instruments (their prices or terms changed). */
  isins?: string[];
}

/**
 * The days a request asks for: `from` (or the first transaction of its instruments, or of all for any other reason
 * than the schedule; the schedule values just `to`) to `to` (today). None when its instruments were never held.
 */
export function rangeOf(request: ValuationRequest, transactions: TransactionItem[], today: IsoDate): { from: IsoDate; to: IsoDate } | undefined {
  const to = request.to ?? today;
  if (request.from) return { from: request.from, to };
  if (request.isins) {
    const isins = new Set(request.isins);
    const first = firstTransactionDate(transactions.filter((t) => t.isin && isins.has(t.isin)));
    return first ? { from: first, to } : undefined;
  }
  if (request.reason && request.reason !== "schedule") return { from: firstTransactionDate(transactions) ?? to, to };
  return { from: to, to };
}

/**
 * One run for several requests: from the earliest day any asks for to the latest, forced when any is. None when no
 * request has a day to value (a change dated after today, an instrument never held).
 */
export function mergedRange(requests: ValuationRequest[], transactions: TransactionItem[], today: IsoDate): { from: IsoDate; to: IsoDate; force: boolean } | undefined {
  const ranges = requests.map((r) => rangeOf(r, transactions, today)).filter((r): r is { from: IsoDate; to: IsoDate } => r !== undefined && r.from <= r.to);
  if (ranges.length === 0) return undefined;
  return {
    from: ranges.reduce((m, r) => (r.from < m ? r.from : m), ranges[0]!.from),
    to: ranges.reduce((m, r) => (r.to > m ? r.to : m), ranges[0]!.to),
    force: requests.some((r) => r.force),
  };
}
