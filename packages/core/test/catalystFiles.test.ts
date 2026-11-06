import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalystDailyFile } from "../src/gpw/catalystDailyFile.ts";
import { parseCatalystQuotes } from "../src/gpw/catalystQuotes.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/catalyst/${name}`, import.meta.url));
function count<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) out[key(t)] = (out[key(t)] ?? 0) + 1;
  return out;
}

describe("parseCatalystDailyFile", () => {
  it("reads the .xlsx layout (from 2026-10-05): the session date, every row, the columns moved by the new average prices", () => {
    const f = parseCatalystDailyFile(fixture("catalyst_20261104.xlsx"));
    expect(f.date).toBe("2026-11-04");
    expect(f.rows).toHaveLength(1052);
    expect(count(f.rows, (r) => r.segment)).toEqual({ corporate: 307, cooperative: 2, municipal: 566, treasury: 136, "mortgage-covered": 38, "public-covered": 3 });
    expect(f.rows.find((r) => r.code === "ACH0427")).toEqual({
      segment: "corporate",
      segmentLabel: "Corporate bonds",
      isin: "PLARCHE00062",
      code: "ACH0427",
      market: "GPW ASO",
      tradingSystem: "C",
      segmentCode: "",
      currency: "PLN",
      maturity: "2027-04-02",
      rate: 0.0824,
      accruedInterest: 7.9,
      nominal: 1000,
      close: 100.9,
      reference: 99.53,
      changePts: 1.37,
      open: 100.89,
      low: 100.89,
      high: 100.9,
      last: 100.9,
      trades: 2,
      volume: 18,
      turnover: 18300,
      blockVolume: 0,
      blockTurnover: 0,
    });
  });

  it("reads the .xls layout (until 2026-10-02), text cells with spaces included", () => {
    const f = parseCatalystDailyFile(fixture("catalyst_20261002.xls"));
    expect(f.date).toBe("2026-10-02");
    expect(f.rows).toHaveLength(1064);
    expect(f.rows.find((r) => r.code === "ACH0427")).toMatchObject({ rate: 0.0824, accruedInterest: 0.9, close: 101, trades: 1, volume: 10, turnover: 10110 });
    // A bond without trades: no open/low/high/last, the close is the reference price.
    expect(f.rows.find((r) => r.code === "ABE0227")).toMatchObject({ open: null, last: null, close: 100, reference: 100, trades: 0, volume: 0 });
  });

  it("reads the oldest layout checked (2020)", () => {
    const f = parseCatalystDailyFile(fixture("catalyst_20200102.xls"));
    expect(f.date).toBe("2020-01-02");
    expect(count(f.rows, (r) => r.segment)).toEqual({ corporate: 492, cooperative: 26, municipal: 187, treasury: 100, "mortgage-covered": 102, "public-covered": 2 });
  });

  it("keeps a row per market, zero-coupon bonds without a rate, and the indexed nominal of IZ bonds", () => {
    const f = parseCatalystDailyFile(fixture("catalyst_20261104.xlsx"));
    const ds = f.rows.filter((r) => r.code === "DS0432");
    expect(ds.map((r) => [r.market, r.close])).toEqual([
      ["GPW RR", 82.19],
      ["BS RR", 99.4],
    ]);
    expect(f.rows.find((r) => r.code === "OK0127" && r.market === "GPW RR")).toMatchObject({ rate: null, accruedInterest: 0, nominal: 1000 });
    expect(f.rows.find((r) => r.code === "IZ0831" && r.market === "GPW RR")?.nominal).toBe(1080.1);
    expect(f.rows.filter((r) => r.currency === "EUR" && r.segment === "corporate")).toHaveLength(36);
  });

  it("fails loudly on a file without the bonds sheet", () => {
    expect(() => parseCatalystDailyFile(fixture("quotes-obligacje-skarbowe.html"))).toThrow();
  });
});

describe("parseCatalystQuotes", () => {
  it("reads a bond's quote: reference, trades, best bid and ask, turnover in units", () => {
    const q = parseCatalystQuotes(readFileSync(new URL("fixtures/catalyst/quotes-obligacje-korporacyjne.html", import.meta.url), "utf8"));
    expect(q.find((x) => x.code === "ADX1227")).toEqual({
      issuer: "",
      code: "ADX1227",
      sustainable: false,
      market: "GPW ASO",
      currency: "PLN",
      reference: 100.8,
      open: 101.2,
      low: 101.2,
      high: 101.2,
      lastTrade: { time: "09:00:29" },
      lastTradeVolume: 25,
      last: 101.2,
      changePct: 0.4,
      bid: { price: 100.82, volume: 64, orders: 1 },
      ask: { price: 101.2, volume: 652, orders: 1 },
      trades: 1,
      volume: 25,
      turnover: 2620,
    });
  });

  it("carries the issuer down its bonds' rows, marks the sustainable segment, dates older last trades", () => {
    const q = parseCatalystQuotes(readFileSync(new URL("fixtures/catalyst/quotes-obligacje-korporacyjne.html", import.meta.url), "utf8"));
    expect(q.find((x) => x.code === "ALE0630")?.issuer).toBe("ALLEGRO.EU");
    expect(q.find((x) => x.code === "ANW1126")).toMatchObject({ issuer: "ANWIM", sustainable: true, markers: ["S"], lastTrade: { date: "2026-08-25" }, bid: null, ask: null, trades: 0 });
    expect(q.find((x) => x.code === "ACH0628")).toMatchObject({ bid: { price: 101.5, volume: 35, orders: 1 }, ask: { price: 105.18, volume: 6, orders: 1 }, lastTrade: { date: "2026-10-21" } });
  });

  it("takes the currency of each table from its heading", () => {
    const q = parseCatalystQuotes(readFileSync(new URL("fixtures/catalyst/quotes-obligacje-korporacyjne.html", import.meta.url), "utf8"));
    expect(new Set(q.map((x) => x.currency))).toEqual(new Set(["PLN", "EUR"]));
  });

  it("an empty segment page gives no rows", () => {
    expect(parseCatalystQuotes(readFileSync(new URL("fixtures/catalyst/quotes-bankowe-papiery-wartosciowe.html", import.meta.url), "utf8"))).toEqual([]);
  });
});
