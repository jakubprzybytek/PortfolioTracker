// API response shapes, taken from the core item types (type-only import: nothing from core is bundled).
import type { AccountSummary, AssetClass, BackfillItem, ClosedPosition, HoldingSnapshot, IndicatorPoint, IndicatorSummary, InstrumentItem, PositionFlow, PriceItem, PriceRow, SnapshotItem, TransactionItem } from "@portfolio/core";

export type { AccountSummary, ClosedPosition, IndicatorPoint, IndicatorSummary, PriceRow };

export type Holding = HoldingSnapshot;
/**
 * `GET /holdings`; `flows`: each position's own cash flows (key `account|isin`), for XIRR; with `?closed=1` also the
 * positions held no more.
 */
export type Snapshot = SnapshotItem & { flows?: Record<string, PositionFlow[]>; closed?: ClosedPosition[] };
/**
 * A day of the portfolio: `total` = positions + cash (fully tracked accounts); `netDeposits` = money put in so far;
 * `byClass` = the value of shares, bonds, cash and other.
 */
export type HistoryPoint = Pick<SnapshotItem, "date" | "totals" | "byType"> & { total?: number; netDeposits?: number; byClass?: Record<AssetClass, number> };
/** `GET /instruments/{isin}/prices` row; inflation-linked (IZ) bonds also carry the indexed nominal per bond in PLN. */
export type Price = Omit<PriceItem, "PK" | "SK"> & { nominal?: number | null };
export type Transaction = Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
/** `GET /transactions` row: the transaction plus its instrument (null for cash movements). */
export type TransactionRow = Transaction & { instrument: Pick<InstrumentItem, "code" | "name" | "type"> | null };
export type Instrument = InstrumentItem & { backfill?: BackfillItem };
export interface Status {
  now: string;
  jobs: Record<string, { status: "running" | "ok" | "failed"; startedAt: string; finishedAt?: string; note?: string; itemsWritten?: number } | null>;
  /** Revaluation requests that failed 3 times and wait in the dead-letter queue (null: couldn't be read). */
  deadLetter?: number | null;
}
export interface Note {
  id: string;
  title: string;
  /** Markdown. */
  body: string;
  createdAt: string;
  updatedAt: string;
}
