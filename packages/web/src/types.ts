// API response shapes, taken from the core item types (type-only import: nothing from core is bundled).
import type { BackfillItem, HoldingSnapshot, InstrumentItem, PriceItem, PriceRow, SnapshotItem, TransactionItem } from "@portfolio/core";

export type { PriceRow };

export type Holding = HoldingSnapshot;
export type Snapshot = SnapshotItem;
export type HistoryPoint = Pick<SnapshotItem, "date" | "totals" | "byType">;
export type Price = Omit<PriceItem, "PK" | "SK">;
export type Transaction = Omit<TransactionItem, "PK" | "SK" | "GSI1PK" | "GSI1SK">;
/** `GET /transactions` row: the transaction plus its instrument (null for cash movements). */
export type TransactionRow = Transaction & { instrument: Pick<InstrumentItem, "code" | "name" | "type"> | null };
export type Instrument = InstrumentItem & { backfill?: BackfillItem };
export interface Status {
  now: string;
  jobs: Record<string, { status: "ok" | "failed"; finishedAt?: string; note?: string; itemsWritten?: number } | null>;
}
