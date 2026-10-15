// What a revaluation has to write for a day, given what's stored: most days of a long range come out the same as
// before, and writing them again is what a revaluation costs (DynamoDB bills writes, the snapshot is ~15–20 units).

import type { HoldingSnapshot, SnapshotItem } from "../db/items.ts";

type Snapshot = Omit<SnapshotItem, "PK" | "SK">;

/** The same JSON whatever the key order, without undefined values (DynamoDB drops them on write). */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

/** Whether the day's snapshot differs from the stored one (none stored: it does); `computedAt` doesn't count. */
export function snapshotChanged(stored: Snapshot | undefined, next: Snapshot): boolean {
  if (!stored) return true;
  const { PK: _pk, SK: _sk, computedAt: _a, ...was } = stored as SnapshotItem;
  const { computedAt: _b, ...now } = next;
  return stable(was) !== stable(now);
}

/** The holdings whose position day (quantity, value, cost) is new or differs from the stored snapshot's. */
export function changedPositionDays(stored: Snapshot | undefined, next: Snapshot): HoldingSnapshot[] {
  if (!stored) return next.holdings;
  const was = new Map(stored.holdings.map((h) => [`${h.account}#${h.isin}`, h]));
  return next.holdings.filter((h) => {
    const w = was.get(`${h.account}#${h.isin}`);
    return !w || w.quantity !== h.quantity || w.value !== h.value || w.cost !== h.cost;
  });
}
