import { describe, expect, it } from "vitest";
import { compareValues, nextSort, parseSort, sortParam, sortRows } from "../src/sort.ts";

describe("sorting a table", () => {
  it("reads and writes the sort in the URL, ignoring unknown columns", () => {
    expect(parseSort("price", ["price", "date"])).toEqual({ key: "price", desc: false });
    expect(parseSort("-date", ["price", "date"])).toEqual({ key: "date", desc: true });
    expect(parseSort("-nope", ["price"])).toBeNull();
    expect(parseSort(undefined, ["price"])).toBeNull();
    expect(sortParam({ key: "date", desc: true })).toBe("-date");
    expect(sortParam(null)).toBeUndefined();
  });

  it("a click cycles ascending, descending, the view's order; firstDesc starts descending", () => {
    expect(nextSort(null, "price")).toEqual({ key: "price", desc: false });
    expect(nextSort({ key: "price", desc: false }, "price")).toEqual({ key: "price", desc: true });
    expect(nextSort({ key: "price", desc: true }, "price")).toBeNull();
    expect(nextSort({ key: "price", desc: true }, "date")).toEqual({ key: "date", desc: false });
    expect(nextSort(null, "yield", true)).toEqual({ key: "yield", desc: true });
    expect(nextSort({ key: "yield", desc: true }, "yield", true)).toEqual({ key: "yield", desc: false });
    expect(nextSort({ key: "yield", desc: false }, "yield", true)).toBeNull();
  });

  it("compares numbers as numbers and text in Polish order, with digits as numbers", () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(["Łódź", "Lublin", "Zabrze", "Ełk"].sort(compareValues)).toEqual(["Ełk", "Lublin", "Łódź", "Zabrze"]);
    expect(["DS1030", "DS0432", "ds0727"].sort(compareValues)).toEqual(["DS0432", "ds0727", "DS1030"]);
  });

  it("puts empty values last in both directions and keeps the order of ties", () => {
    const rows = [
      { id: "a", v: 2 },
      { id: "b", v: null },
      { id: "c", v: 1 },
      { id: "d", v: 2 },
      { id: "e", v: undefined },
    ];
    const ids = (desc: boolean) => sortRows(rows, { key: "v", desc }, (r) => r.v).map((r) => r.id);
    expect(ids(false)).toEqual(["c", "a", "d", "b", "e"]);
    expect(ids(true)).toEqual(["a", "d", "c", "b", "e"]);
    expect(sortRows(rows, null, (r) => r.v)).toEqual(rows);
  });
});
