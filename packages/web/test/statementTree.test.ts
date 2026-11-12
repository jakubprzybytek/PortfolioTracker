import { describe, expect, it } from "vitest";
import { lineShapes, type TreeLine } from "../src/catalyst/statementTree.ts";

const line = (order: number, value: number, parent?: number, item?: string, statement = "balance"): TreeLine => ({ statement, order, value, ...(parent !== undefined ? { parent } : {}), ...(item ? { item } : {}) });

describe("statement tree", () => {
  it("KRS XML order (the total first): depth from the parent links; lines with children are subtotals", () => {
    const s = lineShapes([line(0, 100, undefined, "totalAssets"), line(1, 60, 0), line(2, 60, 1), line(3, 40, 0)]);
    expect([...s.values()].map((x) => [x.depth, x.subtotal])).toEqual([
      [0, true],
      [1, true],
      [2, false],
      [1, false],
    ]);
  });

  it("ESEF order (children first) gives the same depths", () => {
    const s = lineShapes([line(0, 60, 1), line(1, 60, 2), line(2, 100)]);
    expect(s.get("balance#0")).toEqual({ depth: 2, subtotal: false, empty: false });
    expect(s.get("balance#2")).toEqual({ depth: 0, subtotal: true, empty: false });
  });

  it("empty: zero with nothing non-zero under it; a zero subtotal over a non-zero line isn't", () => {
    const s = lineShapes([line(0, 0), line(1, 0, 0), line(2, 0), line(3, 5, 2)]);
    expect(s.get("balance#0")!.empty).toBe(true);
    expect(s.get("balance#1")!.empty).toBe(true);
    expect(s.get("balance#2")!.empty).toBe(false);
  });

  it("no parent links (a PDF transcript): flat, the standard totals marked", () => {
    const s = lineShapes([line(0, 50, undefined, "currentAssets"), line(1, 20, undefined, "cash"), line(2, 70, undefined, "totalAssets")]);
    expect([...s.values()].map((x) => [x.depth, x.subtotal])).toEqual([
      [0, true],
      [0, false],
      [0, true],
    ]);
  });

  it("statements are separate trees; cycles and missing parents don't hang or throw", () => {
    const s = lineShapes([line(0, 1, 1), line(1, 1, 0), line(2, 1, 99), line(0, 1, undefined, undefined, "income"), line(1, 1, 0, undefined, "income")]);
    expect(s.get("balance#0")!.depth).toBeLessThanOrEqual(8);
    expect(s.get("balance#2")!.depth).toBe(0);
    expect(s.get("income#1")).toEqual({ depth: 1, subtotal: false, empty: false });
  });
});
