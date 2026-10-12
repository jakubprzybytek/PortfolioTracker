import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHistoryPage, parseQuotePage } from "../../src/lib/biznesradar.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("BiznesRadar", () => {
  it("reads a history page: sessions newest first (clean % of nominal) and the last page number", () => {
    const { bars, lastPage } = parseHistoryPage(fixture("biznesradar-history-KRU0827.html"), "KRU0827");
    expect(bars).toEqual([
      { date: "2026-10-09", open: 100.42, high: 100.7, low: 100.42, close: 100.45, volume: 520 },
      { date: "2026-10-07", open: 100.87, high: 100.87, low: 100.42, close: 100.42, volume: 300 },
      { date: "2026-10-06", open: 100.89, high: 100.89, low: 100.41, close: 100.41, volume: 614 },
    ]);
    expect(lastPage).toBe(16);
  });

  it("a page without links has one page; a page without the table has no sessions", () => {
    expect(parseHistoryPage("<table class=\"qTableFull\"></table>", "X")).toEqual({ bars: [], lastPage: 1 });
    expect(parseHistoryPage("<html>not found</html>", "X").bars).toEqual([]);
  });

  it("reads the latest quote with the date of its last trade", () => {
    expect(parseQuotePage(fixture("biznesradar-quote-CPS0130.html"))).toEqual({ date: "2026-10-12", open: 104, high: 104, low: 103.97, close: 103.98, volume: 47 });
    expect(parseQuotePage("<html></html>")).toBeUndefined();
  });
});
