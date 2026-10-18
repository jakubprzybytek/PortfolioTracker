// What a revaluation has to write for a day, given what's stored: most days of a long range come out the same as
// before, and writing them again is what a revaluation costs (DynamoDB bills writes, the snapshot is ~15–20 units).

import type { HistoryPointItem, HoldingSnapshot, SnapshotItem } from "../db/items.ts";

type Snapshot = Omit<SnapshotItem, "PK" | "SK">;

/**
 * The same JSON whatever the key order, without undefined values (DynamoDB drops them on write). Written out by hand:
 * rebuilding each object with sorted keys for JSON.stringify (and sorting with localeCompare) cost more than valuing.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

/** What of a snapshot counts when comparing: neither its keys nor `computedAt`. */
const content = (s: Snapshot) => {
  const { PK: _pk, SK: _sk, computedAt: _a, ...rest } = s as SnapshotItem;
  return canonicalJson(rest);
};

/** Whether the day's snapshot differs from the stored one (none stored: it does); `computedAt` doesn't count. */
export function snapshotChanged(stored: Snapshot | undefined, next: Snapshot): boolean {
  return !stored || content(stored) !== content(next);
}

/**
 * A short hash of what counts in a snapshot (cyrb53, 53 bits, as 14 hex digits). Stored in the day's chart point, it
 * tells a revaluation the day is unchanged without reading the stored snapshot.
 */
export function snapshotFingerprint(snapshot: Snapshot): string {
  const text = content(snapshot);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Whether the day's chart point differs from the stored one (none stored: it does). */
export function historyPointChanged(stored: HistoryPointItem | undefined, next: Omit<HistoryPointItem, "PK" | "SK">): boolean {
  if (!stored) return true;
  const { PK: _pk, SK: _sk, ...was } = stored;
  return canonicalJson(was) !== canonicalJson(next);
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
