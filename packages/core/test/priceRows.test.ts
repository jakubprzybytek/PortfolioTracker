import { describe, expect, it } from "vitest";
import type { InstrumentItem, PriceItem } from "../src/db/items.ts";
import { priceRows } from "../src/valuation/priceRows.ts";

const inst = (isin: string, code: string): InstrumentItem =>
  ({ PK: `INST#${isin}`, SK: "META", GSI1PK: "INSTRUMENT", GSI1SK: isin, isin, code, name: `${code} name`, type: "BOND_LISTED", currency: "PLN", venue: "XWAR", sourceIds: {}, active: true, live: false, updatedAt: "" }) as InstrumentItem;
const px = (isin: string, date: string, close: number): PriceItem =>
  ({ PK: `INST#${isin}`, SK: `PX#XWAR#${date}`, isin, venue: "XWAR", date, close, open: null, high: null, low: null, volume: 0, trades: 0, turnover: 0, traded: true, currency: "PLN", source: "t", fetchedAt: "", status: "final" }) as PriceItem;

describe("priceRows", () => {
  it("gives the latest price, its date, staleness and the change over a year, sorted by code", () => {
    const rows = priceRows(
      [inst("PL0000117024", "IZ0836"), inst("PL0000113783", "DS0432")],
      new Map([["PL0000113783", px("PL0000113783", "2026-10-09", 81.09)], ["PL0000117024", px("PL0000117024", "2026-09-20", 87.92)]]),
      new Map([["PL0000113783", px("PL0000113783", "2025-10-10", 79.4)]]),
      "2026-10-11",
    );
    expect(rows.map((r) => r.code)).toEqual(["DS0432", "IZ0836"]);
    expect(rows[0]).toMatchObject({ price: 81.09, priceDate: "2026-10-09", stale: false, yearAgo: { date: "2025-10-10", price: 79.4 }, change1y: 0.0213 });
    expect(rows[1]).toMatchObject({ price: 87.92, stale: true, yearAgo: null, change1y: null }); // 21 days old, no history a year back
  });

  it("marks an instrument without any price", () => {
    const [row] = priceRows([inst("PL0000113783", "DS0432")], new Map(), new Map(), "2026-10-11");
    expect(row).toMatchObject({ price: null, priceDate: null, stale: true, change1y: null });
  });
});
