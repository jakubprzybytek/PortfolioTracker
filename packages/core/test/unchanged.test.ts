import { describe, expect, it } from "vitest";
import type { HistoryPointItem, HoldingSnapshot, SnapshotItem } from "../src/db/items.ts";
import { changedPositionDays, historyPointChanged, snapshotChanged } from "../src/valuation/unchanged.ts";
import { historyPointOf } from "../src/valuation/history.ts";

const holding = (h: Partial<HoldingSnapshot> & Pick<HoldingSnapshot, "account" | "isin">): HoldingSnapshot =>
  ({ code: h.isin, name: h.isin, type: "BOND_RETAIL", currency: "PLN", quantity: 10, cleanPrice: null, priceDate: null, nominal: 100, accruedInterest: null,
    valuePerUnit: 105, value: 1050, cost: 1000, couponsReceived: 0, gain: 50, gainPct: 5, flags: [], ...h }) as HoldingSnapshot;

const snapshot = (holdings: HoldingSnapshot[], computedAt = "2026-10-15T07:00:00.000Z"): Omit<SnapshotItem, "PK" | "SK"> => ({
  date: "2026-10-14",
  holdings,
  totals: { value: 1050, cost: 1000, gain: 50, couponsReceived: 0, cash: 20 },
  accounts: { a: { cash: 20 } },
  byType: { BOND_RETAIL: { value: 1050, cost: 1000 } },
  computedAt,
});

/** As DynamoDB returns it: with its keys, without undefined values, keys in another order. */
const stored = (s: Omit<SnapshotItem, "PK" | "SK">): SnapshotItem =>
  JSON.parse(JSON.stringify({ PK: "PORTFOLIO", SK: `SNAP#${s.date}`, ...Object.fromEntries(Object.entries(s).reverse()) })) as SnapshotItem;

describe("snapshotChanged", () => {
  const h = holding({ account: "a", isin: "EDO0136" });

  it("a day with nothing stored is written", () => {
    expect(snapshotChanged(undefined, snapshot([h]))).toBe(true);
  });

  it("the same day computed again is not, whatever computedAt, key order, keys or undefined fields", () => {
    const was = stored(snapshot([h], "2026-10-14T20:30:00.000Z"));
    expect(snapshotChanged(was, snapshot([{ ...h, priceTime: undefined }], "2026-10-15T07:00:00.000Z"))).toBe(false);
  });

  it("a changed value, a new field or another holding is written", () => {
    const was = stored(snapshot([h]));
    expect(snapshotChanged(was, snapshot([{ ...h, value: 1051 }]))).toBe(true);
    expect(snapshotChanged(was, snapshot([{ ...h, flags: ["no price"] }]))).toBe(true);
    expect(snapshotChanged(was, snapshot([{ ...h, fx: { rate: 4.25, date: "2026-10-13" } }]))).toBe(true);
    expect(snapshotChanged(was, snapshot([h, holding({ account: "a", isin: "COI0128" })]))).toBe(true);
    expect(snapshotChanged(was, { ...snapshot([h]), totals: { ...snapshot([h]).totals, cash: 21 } })).toBe(true);
  });
});

describe("changedPositionDays", () => {
  const edo = holding({ account: "a", isin: "EDO0136" });
  const coi = holding({ account: "a", isin: "COI0128" });

  it("with nothing stored, every position", () => {
    expect(changedPositionDays(undefined, snapshot([edo, coi]))).toEqual([edo, coi]);
  });

  it("only positions that are new or whose quantity, value or cost changed", () => {
    const was = stored(snapshot([edo, coi]));
    const otherAccount = holding({ account: "b", isin: "EDO0136" });
    const next = snapshot([{ ...edo, gainPct: 6 }, { ...coi, value: 1060 }, otherAccount]);
    expect(changedPositionDays(was, next).map((p) => `${p.account}#${p.isin}`)).toEqual(["a#COI0128", "b#EDO0136"]);
    expect(changedPositionDays(was, snapshot([{ ...edo, quantity: 11 }, { ...coi, cost: 999 }]))).toHaveLength(2);
  });
});

describe("historyPointChanged", () => {
  const h = holding({ account: "a", isin: "EDO0136" });
  const point = historyPointOf(snapshot([h]));
  /** As DynamoDB returns it: with its keys, keys in another order. */
  const storedPoint = (p: typeof point): HistoryPointItem => JSON.parse(JSON.stringify({ PK: "HISTORY", SK: p.date, ...Object.fromEntries(Object.entries(p).reverse()) })) as HistoryPointItem;

  it("a day without a point gets one (days valued before points existed)", () => {
    expect(historyPointChanged(undefined, point)).toBe(true);
  });

  it("the same point is not written again, whatever the key order", () => {
    expect(historyPointChanged(storedPoint(point), historyPointOf(snapshot([h], "2026-10-16T07:00:00.000Z")))).toBe(false);
  });

  it("a different value is", () => {
    expect(historyPointChanged(storedPoint(point), historyPointOf(snapshot([{ ...h, value: 1100 }])))).toBe(true);
  });
});
