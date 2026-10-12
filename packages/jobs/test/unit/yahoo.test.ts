import { describe, expect, it } from "vitest";
import { parseYahooChart, yahooSymbol } from "../../src/lib/yahoo.ts";

describe("yahooSymbol", () => {
  it("maps the sheet's EXCHANGE:CODE tickers to Yahoo symbols", () => {
    expect(yahooSymbol("AMS:VWRL")).toBe("VWRL.AS");
    expect(yahooSymbol("FRA:EUNK")).toBe("EUNK.DE");
    expect(yahooSymbol("LON:CSPX")).toBe("CSPX.L");
    expect(yahooSymbol("VWCE.DE")).toBe("VWCE.DE");
    expect(() => yahooSymbol("XYZ:ABC")).toThrow(/No Yahoo suffix/);
  });
});

describe("parseYahooChart", () => {
  // Shape of /v8/finance/chart/VWRL.AS?interval=1d (trimmed). Timestamps are the session open in UTC.
  const chart = (currency: string, gmtoffset: number, timestamp: number[], close: (number | null)[]) => ({
    chart: { result: [{ meta: { symbol: "VWRL.AS", currency, exchangeName: "AMS", exchangeTimezoneName: "Europe/Amsterdam", gmtoffset }, timestamp, indicators: { quote: [{ close }] } }], error: null },
  });

  it("gives daily closes in the exchange's time zone, skipping days without a close", () => {
    // 2026-10-09 07:00 UTC, 2026-10-12 07:00 UTC (CEST, +2 h), and a day with no close
    const d = parseYahooChart(chart("EUR", 7200, [1791529200, 1791788400, 1791874800], [167.12345678, 167.7, null]));
    expect(d).toMatchObject({ symbol: "VWRL.AS", currency: "EUR", exchange: "AMS", timezone: "Europe/Amsterdam" });
    expect(d.closes).toEqual([
      { date: "2026-10-09", close: 167.1235 },
      { date: "2026-10-12", close: 167.7 },
    ]);
  });

  it("converts London prices in pence to pounds", () => {
    const d = parseYahooChart(chart("GBp", 3600, [1791788400], [8435.5]));
    expect(d.currency).toBe("GBP");
    expect(d.closes).toEqual([{ date: "2026-10-12", close: 84.355 }]);
  });

  it("throws on an error response", () => {
    expect(() => parseYahooChart({ chart: { result: undefined, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } })).toThrow(/delisted/);
  });
});
