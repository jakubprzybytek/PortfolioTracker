import { describe, expect, it } from "vitest";
import type { TransactionItem } from "../src/db/items.ts";
import { mergedRange, rangeOf } from "../src/valuation/range.ts";

const tx = (date: string, isin?: string) => ({ date, isin, account: "A", id: date, type: "BUY", amount: -100 }) as TransactionItem;
const txs = [tx("2026-03-01", "PL0000000002"), tx("2022-03-01", "PL0000000001"), tx("2023-05-10"), tx("2024-01-15", "PL0000000002")];
const today = "2026-10-18";

describe("rangeOf", () => {
  it("the schedule values today; any other reason everything since the first transaction", () => {
    expect(rangeOf({}, txs, today)).toEqual({ from: today, to: today });
    expect(rangeOf({ reason: "schedule" }, txs, today)).toEqual({ from: today, to: today });
    expect(rangeOf({ reason: "import" }, txs, today)).toEqual({ from: "2022-03-01", to: today });
  });

  it("`from` (and `to`) as given", () => {
    expect(rangeOf({ reason: "transaction added", from: "2025-01-02" }, txs, today)).toEqual({ from: "2025-01-02", to: today });
    expect(rangeOf({ from: "2025-01-02", to: "2025-02-01" }, txs, today)).toEqual({ from: "2025-01-02", to: "2025-02-01" });
  });

  it("instruments: from the first transaction of any of them; none held, nothing", () => {
    expect(rangeOf({ reason: "backfill", isins: ["PL0000000002"] }, txs, today)).toEqual({ from: "2024-01-15", to: today });
    expect(rangeOf({ reason: "retail-rates", isins: ["PL0000000002", "PL0000000001"] }, txs, today)).toEqual({ from: "2022-03-01", to: today });
    expect(rangeOf({ reason: "backfill", isins: ["PL0000000009"] }, txs, today)).toBeUndefined();
  });
});

describe("mergedRange", () => {
  it("one run from the earliest day asked for to the latest, forced if any request is", () => {
    expect(mergedRange([{ reason: "schedule" }, { reason: "transaction added", from: "2025-06-01" }, { reason: "backfill", isins: ["PL0000000002"] }], txs, today)).toEqual({
      from: "2024-01-15",
      to: today,
      force: false,
    });
    expect(mergedRange([{ from: "2025-06-01", to: "2025-07-01" }, { from: "2025-08-01", to: "2025-09-01", force: true }], txs, today)).toEqual({ from: "2025-06-01", to: "2025-09-01", force: true });
  });

  it("requests with nothing to value don't count; none left, no run", () => {
    expect(mergedRange([{ reason: "transaction added", from: "2026-11-01" }, { reason: "live prices", from: "2026-10-17" }], txs, today)).toEqual({ from: "2026-10-17", to: today, force: false });
    expect(mergedRange([{ reason: "transaction added", from: "2026-11-01" }, { reason: "backfill", isins: ["PL0000000009"] }], txs, today)).toBeUndefined();
  });
});
